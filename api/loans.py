"""
Loan application router — VaultIQ

POST /loans/apply
  - Requires a valid JWT with kyc_status=verified
  - Creates a LoanApplication record
  - Calls the AI risk engine (score_borrower)
  - Returns the trust score and routes the application based on risk tier:

    BLOCKED       → HTTP 403  (application rejected immediately)
    MANUAL_REVIEW → HTTP 202  (flagged, queued for human analyst)
    HIGH          → HTTP 202  (flagged, analyst review required)
    MEDIUM        → HTTP 201  (accepted, enhanced monitoring)
    LOW           → HTTP 201  (accepted, standard processing)
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from api.auth import get_current_user
from api.database import get_db
from api.models import AuditLog, LoanApplication, LoanStatus, RiskTier
from api.risk_engine import RiskResult, score_borrower

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/loans", tags=["loans"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class LoanApplyRequest(BaseModel):
    amount: float = Field(..., gt=0, le=500_000, description="Requested loan amount in USD (max 500,000)")
    purpose: str = Field(..., min_length=3, max_length=500)
    duration_months: int = Field(..., ge=1, le=360)
    device_info: dict = Field(
        default_factory=dict,
        description="Optional device/session metadata (user-agent, IP hints, etc.)",
    )

    @field_validator("amount")
    @classmethod
    def round_amount(cls, v: float) -> float:
        return round(v, 2)

    @field_validator("purpose")
    @classmethod
    def strip_purpose(cls, v: str) -> str:
        return v.strip()


class LoanApplyResponse(BaseModel):
    loan_id: int
    amount: float
    purpose: str
    duration_months: int
    status: str
    trust_score: int
    risk_tier: str
    risk_narrative: str
    message: str


# ---------------------------------------------------------------------------
# KYC guard — extracted from token claims
# ---------------------------------------------------------------------------

def _require_kyc_verified(payload: dict = Depends(get_current_user)) -> dict:
    if payload.get("kyc_status") != "verified":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="KYC verification is required before applying for a loan.",
        )
    return payload


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/apply",
    response_model=LoanApplyResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        202: {"description": "Application flagged for manual review"},
        403: {"description": "Application blocked by risk engine or KYC not verified"},
    },
)
def apply_for_loan(
    body: LoanApplyRequest,
    request: Request,
    payload: Annotated[dict, Depends(_require_kyc_verified)],
    db: Annotated[Session, Depends(get_db)],
):
    """
    Submit a loan application. The AI risk engine scores the request in real-time.
    """
    user_id: int = int(payload["user_id"])
    ip = request.client.host if request.client else None

    # 1. Create the application record (status=pending until scored)
    loan = LoanApplication(
        applicant_id=user_id,
        amount=body.amount,
        term_months=body.duration_months,
        purpose=body.purpose,
        status=LoanStatus.pending,
    )
    db.add(loan)
    db.flush()  # populate loan.id without committing

    db.add(
        AuditLog(
            actor_id=user_id,
            loan_application_id=loan.id,
            action="loan.submitted",
            detail=f"amount=${body.amount:,.2f} term={body.duration_months}mo purpose={body.purpose!r}",
            ip_address=ip,
        )
    )

    # 2. Risk scoring (always returns — never raises)
    result: RiskResult = score_borrower(
        user_id=user_id,
        loan_application_id=loan.id,
        loan_amount=body.amount,
        loan_purpose=body.purpose,
        duration_months=body.duration_months,
        device_info=body.device_info,
        db=db,
        ip_address=ip,
    )

    # 3. Route by tier
    return _build_response(loan=loan, result=result, db=db)


# ---------------------------------------------------------------------------
# Tier routing
# ---------------------------------------------------------------------------

_TIER_CONFIG: dict[RiskTier, tuple[int, str, str]] = {
    # tier → (http_status, loan_status, message)
    RiskTier.low: (
        status.HTTP_201_CREATED,
        LoanStatus.under_review,
        "Application accepted. Processing will begin shortly.",
    ),
    RiskTier.medium: (
        status.HTTP_201_CREATED,
        LoanStatus.under_review,
        "Application accepted with enhanced monitoring.",
    ),
    RiskTier.high: (
        status.HTTP_202_ACCEPTED,
        LoanStatus.under_review,
        "Application flagged for analyst review due to elevated risk indicators.",
    ),
    RiskTier.manual_review: (
        status.HTTP_202_ACCEPTED,
        LoanStatus.under_review,
        "Application queued for manual review. Automated scoring was unavailable.",
    ),
    RiskTier.blocked: (
        status.HTTP_403_FORBIDDEN,
        LoanStatus.rejected,
        "Application declined. Risk profile does not meet lending criteria.",
    ),
}


def _build_response(
    *,
    loan: LoanApplication,
    result: RiskResult,
    db: Session,
) -> LoanApplyResponse:
    http_code, loan_status, message = _TIER_CONFIG[result.risk_tier]

    loan.status = loan_status
    loan.updated_at = datetime.now(timezone.utc)
    db.commit()

    # Generate unsigned PDF for every non-blocked application
    if result.risk_tier != RiskTier.blocked:
        try:
            from api.pdf_generator import generate_loan_pdf
            generate_loan_pdf(loan_id=loan.id, db=db)
        except Exception as exc:
            # PDF failure must never abort a loan application
            logger.warning("PDF generation failed for loan %s: %s", loan.id, exc)

    response_body = LoanApplyResponse(
        loan_id=loan.id,
        amount=loan.amount,
        purpose=loan.purpose or "",
        duration_months=loan.term_months,
        status=loan_status.value,
        trust_score=result.trust_score,
        risk_tier=result.risk_tier.value,
        risk_narrative=result.risk_narrative,
        message=message,
    )

    if http_code == status.HTTP_403_FORBIDDEN:
        raise HTTPException(status_code=http_code, detail=response_body.model_dump())

    if http_code == status.HTTP_202_ACCEPTED:
        return JSONResponse(content=response_body.model_dump(), status_code=202)

    return response_body


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).parent.parent


def _get_loan_authorised(
    loan_id: int,
    payload: dict,
    db: Session,
) -> LoanApplication:
    """Fetch a loan and verify the caller is the applicant, analyst, or admin."""
    loan: LoanApplication | None = (
        db.query(LoanApplication).filter(LoanApplication.id == loan_id).first()
    )
    if loan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found.")
    requester_id   = int(payload.get("user_id", 0))
    requester_role = payload.get("role", "")
    if requester_role not in ("admin", "analyst") and loan.applicant_id != requester_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorised to access this document.",
        )
    return loan


# ---------------------------------------------------------------------------
# Download unsigned endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/{loan_id}/download-unsigned",
    summary="Download unsigned loan agreement PDF",
    response_class=FileResponse,
    responses={
        200: {"content": {"application/pdf": {}}},
        403: {"description": "Not authorised to access this document"},
        404: {"description": "Loan not found or PDF not yet generated"},
    },
)
def download_unsigned_pdf(
    loan_id: int,
    request: Request,
    payload: Annotated[dict, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Return the unsigned PDF agreement. Caller must be the applicant, analyst, or admin."""
    loan = _get_loan_authorised(loan_id, payload, db)

    if not loan.pdf_unsigned_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Unsigned PDF has not been generated yet.")
    pdf_path = PROJECT_ROOT / loan.pdf_unsigned_path
    if not pdf_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="PDF file not found on disk.")

    db.add(AuditLog(
        actor_id=int(payload.get("user_id", 0)),
        loan_application_id=loan_id,
        action="loan.document_downloaded",
        detail="unsigned PDF downloaded",
        ip_address=request.client.host if request.client else None,
    ))
    db.commit()

    return FileResponse(path=str(pdf_path), media_type="application/pdf",
                        filename=f"VaultIQ_LoanAgreement_{loan_id:05d}_UNSIGNED.pdf")


# ---------------------------------------------------------------------------
# Sign endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/{loan_id}/sign",
    status_code=status.HTTP_200_OK,
    summary="Sign loan agreement (PAdES-B → PAdES-T → XAdES-T)",
    responses={
        403: {"description": "Not authorised or unsigned PDF missing"},
        404: {"description": "Loan not found"},
        500: {"description": "A signing step failed"},
    },
)
def sign_loan_agreement(
    loan_id: int,
    payload: Annotated[dict, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """
    Execute the three-step signing pipeline in sequence:

    1. **PAdES-B** — CAdES-detached signature with the platform leaf certificate
    2. **PAdES-T** — Adds an RFC 3161 document timestamp from freetsa.org
    3. **XAdES-T** — Detached XML signature + signature timestamp token

    Returns the relative paths and SHA-256 hashes of all three artifacts.
    Requires a valid JWT. The applicant may only sign their own loan; analysts
    and admins may sign any loan.
    """
    from api.signer import generate_xades_t, sign_pades_b, sign_pades_t

    loan = _get_loan_authorised(loan_id, payload, db)

    if not loan.pdf_unsigned_path:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unsigned PDF must be generated before signing.",
        )

    # Step 1 — PAdES-B
    try:
        pades_b_path = sign_pades_b(loan_id=loan_id, db=db)
    except Exception as exc:
        logger.error("PAdES-B failed loan=%s: %s", loan_id, exc)
        raise HTTPException(status_code=500, detail=f"PAdES-B signing failed: {exc}")

    # Step 2 — PAdES-T
    try:
        pades_t_path = sign_pades_t(loan_id=loan_id, db=db)
    except Exception as exc:
        logger.error("PAdES-T failed loan=%s: %s", loan_id, exc)
        raise HTTPException(status_code=500, detail=f"PAdES-T timestamp failed: {exc}")

    # Step 3 — XAdES-T
    try:
        xades_path = generate_xades_t(loan_id=loan_id, db=db)
    except Exception as exc:
        logger.error("XAdES-T failed loan=%s: %s", loan_id, exc)
        raise HTTPException(status_code=500, detail=f"XAdES-T generation failed: {exc}")

    def _rel(p: Path) -> str:
        return str(p.relative_to(PROJECT_ROOT)).replace("\\", "/")

    import hashlib
    return {
        "loan_id":  loan_id,
        "pades_b":  {"path": _rel(pades_b_path), "sha256": hashlib.sha256(pades_b_path.read_bytes()).hexdigest()},
        "pades_t":  {"path": _rel(pades_t_path), "sha256": hashlib.sha256(pades_t_path.read_bytes()).hexdigest()},
        "xades_t":  {"path": _rel(xades_path),   "sha256": hashlib.sha256(xades_path.read_bytes()).hexdigest()},
    }


# ---------------------------------------------------------------------------
# Download signed (PAdES-T) endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/{loan_id}/download-signed",
    summary="Download signed loan agreement (PAdES-T PDF)",
    response_class=FileResponse,
    responses={
        200: {"content": {"application/pdf": {}}},
        403: {"description": "Not authorised"},
        404: {"description": "Loan not found or PDF not yet signed"},
    },
)
def download_signed_pdf(
    loan_id: int,
    request: Request,
    payload: Annotated[dict, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Return the PAdES-T signed PDF. Caller must be the applicant, analyst, or admin."""
    loan = _get_loan_authorised(loan_id, payload, db)

    if not loan.pdf_pades_t_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Signed PDF not available yet. Call POST /loans/{id}/sign first.")
    pdf_path = PROJECT_ROOT / loan.pdf_pades_t_path
    if not pdf_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Signed PDF file not found on disk.")

    db.add(AuditLog(
        actor_id=int(payload.get("user_id", 0)),
        loan_application_id=loan_id,
        action="loan.document_downloaded",
        detail="PAdES-T signed PDF downloaded",
        ip_address=request.client.host if request.client else None,
    ))
    db.commit()

    return FileResponse(path=str(pdf_path), media_type="application/pdf",
                        filename=f"VaultIQ_LoanAgreement_{loan_id:05d}_SIGNED.pdf")

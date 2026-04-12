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
    loan_amount: float = Field(..., gt=0, description="Requested loan amount in USD")
    loan_purpose: str = Field(..., min_length=5, max_length=500)
    duration_months: int = Field(..., ge=1, le=360)
    device_info: dict = Field(
        default_factory=dict,
        description="Optional device/session metadata (user-agent, IP hints, etc.)",
    )

    @field_validator("loan_amount")
    @classmethod
    def round_amount(cls, v: float) -> float:
        return round(v, 2)


class LoanApplyResponse(BaseModel):
    application_id: int
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
            detail={
                "code": "KYC_REQUIRED",
                "reason": "KYC verification is required before applying for a loan.",
            },
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
        amount=body.loan_amount,
        term_months=body.duration_months,
        purpose=body.loan_purpose,
        status=LoanStatus.pending,
    )
    db.add(loan)
    db.flush()  # populate loan.id without committing

    db.add(
        AuditLog(
            actor_id=user_id,
            loan_application_id=loan.id,
            action="loan.submitted",
            detail=f"amount=${body.loan_amount:,.2f} term={body.duration_months}mo purpose={body.loan_purpose!r}",
            ip_address=ip,
        )
    )

    # 2. Risk scoring (always returns — never raises)
    result: RiskResult = score_borrower(
        user_id=user_id,
        loan_application_id=loan.id,
        loan_amount=body.loan_amount,
        loan_purpose=body.loan_purpose,
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
        application_id=loan.id,
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
# Download endpoint
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).parent.parent


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
    payload: Annotated[dict, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """
    Return the unsigned PDF agreement for the given loan application.

    The requesting user must be the applicant, an analyst, or an admin.
    """
    loan: LoanApplication | None = (
        db.query(LoanApplication).filter(LoanApplication.id == loan_id).first()
    )
    if loan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found.")

    # Authorisation: applicant can only access their own document
    requester_id = int(payload.get("user_id", 0))
    requester_role = payload.get("role", "")
    if requester_role not in ("admin", "analyst") and loan.applicant_id != requester_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorised to access this document.",
        )

    if not loan.pdf_unsigned_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF has not been generated for this application yet.",
        )

    pdf_path = PROJECT_ROOT / loan.pdf_unsigned_path
    if not pdf_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF file not found on disk. Please contact support.",
        )

    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=f"VaultIQ_LoanAgreement_{loan_id:05d}_UNSIGNED.pdf",
    )

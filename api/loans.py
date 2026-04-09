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

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from api.auth import get_current_user
from api.database import get_db
from api.models import AuditLog, LoanApplication, LoanStatus, RiskTier
from api.risk_engine import RiskResult, score_borrower

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

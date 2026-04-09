"""
AI Risk Scoring Engine — VaultIQ

score_borrower() is the single entry point:
  1. Loads borrower context from the DB (account age, loan history)
  2. Calls Amazon Nova via Bedrock for a structured risk score
  3. Falls back to MANUAL_REVIEW on any API / parse failure (never auto-approves)
  4. Persists trust_score, risk_tier, risk_narrative to the LoanApplication row
  5. Writes an AuditLog entry
  6. Returns a RiskResult for the caller to act on
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from api.bedrock import BedrockExtractionError, score_borrower_risk
from api.models import AuditLog, LoanApplication, RiskTier, User

logger = logging.getLogger(__name__)


@dataclass
class RiskResult:
    trust_score: int
    risk_tier: RiskTier
    risk_narrative: str


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def score_borrower(
    *,
    user_id: int,
    loan_application_id: int,
    loan_amount: float,
    loan_purpose: str,
    duration_months: int,
    device_info: dict,
    db: Session,
    ip_address: str | None = None,
) -> RiskResult:
    """
    Score a loan application and persist the result.

    Always returns a RiskResult — never raises.  If Nova is unavailable or
    returns garbage, risk_tier defaults to MANUAL_REVIEW so that no loan is
    silently auto-approved.
    """
    user: User | None = db.query(User).filter(User.id == user_id).first()
    loan: LoanApplication | None = (
        db.query(LoanApplication).filter(LoanApplication.id == loan_application_id).first()
    )

    if user is None or loan is None:
        logger.error("score_borrower: user %s or loan %s not found", user_id, loan_application_id)
        return _manual_review_fallback(
            loan=loan,
            reason="Borrower or loan record not found during risk scoring.",
            db=db,
            user_id=user_id,
            ip_address=ip_address,
        )

    account_age_days = _account_age_days(user.created_at)
    previous_loan_count = (
        db.query(LoanApplication)
        .filter(
            LoanApplication.applicant_id == user_id,
            LoanApplication.id != loan_application_id,
        )
        .count()
    )

    try:
        raw = score_borrower_risk(
            full_name=user.full_name or "Unknown",
            kyc_status=user.kyc_status.value,
            account_age_days=account_age_days,
            previous_loan_count=previous_loan_count,
            loan_amount=loan_amount,
            loan_purpose=loan_purpose,
            duration_months=duration_months,
            device_info=device_info,
        )
        result = RiskResult(
            trust_score=raw.trust_score,
            risk_tier=RiskTier(raw.risk_tier),
            risk_narrative=raw.risk_narrative,
        )
    except (BedrockExtractionError, ValueError, KeyError) as exc:
        logger.warning(
            "Risk scoring failed for user=%s loan=%s: %s — defaulting to MANUAL_REVIEW",
            user_id, loan_application_id, exc,
        )
        return _manual_review_fallback(
            loan=loan,
            reason=f"Automated scoring unavailable ({type(exc).__name__}). Manual review required.",
            db=db,
            user_id=user_id,
            ip_address=ip_address,
        )

    _persist(loan=loan, result=result, db=db, user_id=user_id, ip_address=ip_address)
    return result


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _account_age_days(created_at: datetime) -> int:
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return max(0, (datetime.now(timezone.utc) - created_at).days)


def _persist(
    *,
    loan: LoanApplication,
    result: RiskResult,
    db: Session,
    user_id: int,
    ip_address: str | None,
) -> None:
    loan.trust_score = result.trust_score
    loan.risk_tier = result.risk_tier
    loan.risk_narrative = result.risk_narrative
    loan.updated_at = datetime.now(timezone.utc)

    db.add(
        AuditLog(
            actor_id=user_id,
            loan_application_id=loan.id,
            action="risk.scored",
            detail=(
                f"trust_score={result.trust_score} "
                f"risk_tier={result.risk_tier.value} | "
                f"{result.risk_narrative}"
            ),
            ip_address=ip_address,
        )
    )
    db.commit()


def _manual_review_fallback(
    *,
    loan: LoanApplication | None,
    reason: str,
    db: Session,
    user_id: int,
    ip_address: str | None,
) -> RiskResult:
    result = RiskResult(
        trust_score=0,
        risk_tier=RiskTier.manual_review,
        risk_narrative=reason,
    )
    if loan is not None:
        _persist(loan=loan, result=result, db=db, user_id=user_id, ip_address=ip_address)
    return result

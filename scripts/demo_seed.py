"""
scripts/demo_seed.py — VaultIQ demonstration seed

Usage
-----
  python scripts/demo_seed.py

What it does
------------
  1. Creates all database tables (idempotent — safe to run multiple times)
  2. Seeds one applicant user matching the KYC registry (Alice Martin)
  3. Seeds one admin user for the compliance dashboard
  4. Sets the applicant's KYC status to "verified"
  5. Creates a sample loan application with pre-scored risk data
     (no AWS Bedrock call needed — scores are hardcoded for demo)
  6. Writes audit log entries for every action
  7. Issues and prints short-lived JWT tokens for both users

Requirements
------------
  - certs/leaf.key.pem + leaf.cert.pem must exist
    (run: python certs/generate_certs.py  if they don't)
  - .env must be present (copy from .env.example)
  - Python packages installed (pip install -r requirements.txt)
"""

import sys
from pathlib import Path

# Allow `api.*` imports when running from the project root or scripts/
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from datetime import datetime, timezone

import bcrypt as _bcrypt_lib

from api.auth import create_access_token
from api.database import SessionLocal, init_db
from api.models import (
    AuditLog,
    KYCStatus,
    LoanApplication,
    LoanStatus,
    RiskTier,
    User,
    UserRole,
)


def _hash(password: str) -> str:
    return _bcrypt_lib.hashpw(password.encode(), _bcrypt_lib.gensalt()).decode()


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

APPLICANT = {
    "email":    "alice.martin@example.com",
    "password": "demo-password-123",
    "name":     "Alice Martin",
}

ADMIN = {
    "email":    "admin@vaultiq.internal",
    "password": "admin-demo-pass",
    "name":     "VaultIQ Admin",
}

SAMPLE_LOAN = {
    "amount":          15_000.00,
    "term_months":     36,
    "purpose":         "Home Improvement",
    "trust_score":     78,
    "risk_tier":       RiskTier.medium,
    "risk_narrative": (
        "Applicant has verified KYC status with a clean identity record. "
        "Loan amount is within standard thresholds for the requested term. "
        "Medium risk tier assigned due to limited prior loan history. "
        "Enhanced monitoring recommended during repayment."
    ),
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("  VaultIQ Demo Seed")
    print("=" * 60)
    print()

    # 1. Create tables
    init_db()
    print("✓ Database tables initialised (idempotent)")

    db = SessionLocal()
    try:
        # ── Applicant ────────────────────────────────────────────────────────
        applicant = db.query(User).filter(User.email == APPLICANT["email"]).first()
        if applicant is None:
            applicant = User(
                email=APPLICANT["email"],
                hashed_password=_hash(APPLICANT["password"]),
                full_name=APPLICANT["name"],
                role=UserRole.applicant,
                kyc_status=KYCStatus.pending,   # unverified — let the demo flow verify via KYC step
                is_active=True,
            )
            db.add(applicant)
            db.flush()
            print(f"✓ Applicant created : {applicant.email}  (id={applicant.id})")
        else:
            # Reset KYC so the full 4-step flow can be demoed again
            applicant.kyc_status = KYCStatus.pending
            applicant.updated_at = datetime.now(timezone.utc)
            print(f"✓ Applicant reset   : {applicant.email}  kyc=pending  (id={applicant.id})")

        # ── Admin ─────────────────────────────────────────────────────────────
        admin = db.query(User).filter(User.email == ADMIN["email"]).first()
        if admin is None:
            admin = User(
                email=ADMIN["email"],
                hashed_password=_hash(ADMIN["password"]),
                full_name=ADMIN["name"],
                role=UserRole.admin,
                kyc_status=KYCStatus.verified,
                is_active=True,
            )
            db.add(admin)
            db.flush()
            print(f"✓ Admin created     : {admin.email}  (id={admin.id})")
        else:
            print(f"✓ Admin exists      : {admin.email}  (id={admin.id})")

        # ── Sample loan ───────────────────────────────────────────────────────
        existing_loan = (
            db.query(LoanApplication)
            .filter(LoanApplication.applicant_id == applicant.id)
            .first()
        )
        if existing_loan is None:
            loan = LoanApplication(
                applicant_id=applicant.id,
                amount=SAMPLE_LOAN["amount"],
                term_months=SAMPLE_LOAN["term_months"],
                purpose=SAMPLE_LOAN["purpose"],
                status=LoanStatus.under_review,
                trust_score=SAMPLE_LOAN["trust_score"],
                risk_tier=SAMPLE_LOAN["risk_tier"],
                risk_narrative=SAMPLE_LOAN["risk_narrative"],
            )
            db.add(loan)
            db.flush()
            db.add(AuditLog(
                actor_id=applicant.id,
                loan_application_id=loan.id,
                action="loan.submitted",
                detail=(
                    f"amount=${SAMPLE_LOAN['amount']:,.2f} "
                    f"term={SAMPLE_LOAN['term_months']}mo "
                    f"purpose='{SAMPLE_LOAN['purpose']}' [seeded]"
                ),
                ip_address="127.0.0.1",
            ))
            db.add(AuditLog(
                actor_id=applicant.id,
                loan_application_id=loan.id,
                action="risk.scored",
                detail=(
                    f"trust_score={SAMPLE_LOAN['trust_score']} "
                    f"risk_tier={SAMPLE_LOAN['risk_tier'].value} | "
                    "Seeded sample — medium risk profile [demo_seed.py]"
                ),
                ip_address="127.0.0.1",
            ))
            print(f"✓ Sample loan created: id={loan.id}  amount=${SAMPLE_LOAN['amount']:,.2f}  tier=MEDIUM")
        else:
            loan = existing_loan
            print(f"✓ Sample loan exists : id={loan.id}  amount=${loan.amount:,.2f}  tier={loan.risk_tier}")

        db.commit()

        # ── Issue demo JWTs ───────────────────────────────────────────────────
        applicant_token = create_access_token(
            subject=str(applicant.id),
            extra_claims={
                "user_id":    applicant.id,
                "kyc_status": KYCStatus.verified.value,
                "role":       UserRole.applicant.value,
            },
        )
        admin_token = create_access_token(
            subject=str(admin.id),
            extra_claims={
                "user_id":    admin.id,
                "kyc_status": KYCStatus.verified.value,
                "role":       UserRole.admin.value,
            },
        )

        print()
        print("=" * 60)
        print("  DEMO TOKENS  (valid 15 min — regenerate with this script)")
        print("=" * 60)
        print()
        print(f"Applicant JWT  ({applicant.email}):")
        print(f"  {applicant_token}")
        print()
        print(f"Admin JWT  ({admin.email}):")
        print(f"  {admin_token}")
        print()
        print("=" * 60)
        print(f"  applicant user_id : {applicant.id}")
        print(f"  admin user_id     : {admin.id}")
        print(f"  sample loan id    : {loan.id}")
        print()
        print("  API docs  → http://localhost:8000/docs")
        print("  Audit log → GET /audit-log  (Authorization: Bearer <admin_token>)")
        print("=" * 60)

    finally:
        db.close()


if __name__ == "__main__":
    main()

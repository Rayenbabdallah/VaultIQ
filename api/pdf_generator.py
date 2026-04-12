"""
PDF loan agreement generator — VaultIQ

generate_loan_pdf(loan_id, db)
  1. Fetches LoanApplication + User from the DB
  2. Builds the repayment schedule (standard amortisation)
  3. Renders templates/loan_agreement.html via Jinja2
  4. Converts to PDF with WeasyPrint
  5. Writes to vault/unsigned/{loan_id}.pdf
  6. Updates LoanApplication.pdf_unsigned_path
  7. Appends an AuditLog entry
  8. Returns the Path to the generated file

WeasyPrint system requirements (Windows):
  Install the GTK3 runtime for Windows from:
  https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases
  and ensure it is on PATH before starting the API server.
"""

import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.orm import Session
from weasyprint import HTML

from api.models import AuditLog, LoanApplication, User

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).parent.parent
TEMPLATES_DIR = PROJECT_ROOT / "templates"
VAULT_UNSIGNED_DIR = PROJECT_ROOT / "vault" / "unsigned"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_ANNUAL_RATE_PCT = float(os.getenv("LOAN_ANNUAL_RATE_PCT", "8.0"))

# ---------------------------------------------------------------------------
# Jinja2 environment (cached)
# ---------------------------------------------------------------------------

_jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate_loan_pdf(loan_id: int, db: Session) -> Path:
    """
    Generate the unsigned loan agreement PDF for the given loan application.

    Returns the path to the saved PDF file.
    Raises LookupError if the loan or its applicant cannot be found.
    """
    loan: LoanApplication | None = (
        db.query(LoanApplication).filter(LoanApplication.id == loan_id).first()
    )
    if loan is None:
        raise LookupError(f"LoanApplication {loan_id} not found")

    user: User | None = db.query(User).filter(User.id == loan.applicant_id).first()
    if user is None:
        raise LookupError(f"User {loan.applicant_id} not found for loan {loan_id}")

    annual_rate = DEFAULT_ANNUAL_RATE_PCT
    schedule = _amortisation_schedule(
        principal=loan.amount,
        annual_rate_pct=annual_rate,
        months=loan.term_months,
    )
    monthly_payment = schedule[0]["payment"] if schedule else 0.0
    total_repayable = sum(r["payment"] for r in schedule)
    total_interest = sum(r["interest"] for r in schedule)

    html_content = _render_template(
        loan=loan,
        user=user,
        schedule=schedule,
        annual_rate_pct=annual_rate,
        monthly_payment=monthly_payment,
        total_repayable=total_repayable,
        total_interest=total_interest,
    )

    pdf_path = _write_pdf(loan_id=loan_id, html_content=html_content)

    # Persist path + audit
    loan.pdf_unsigned_path = str(pdf_path.relative_to(PROJECT_ROOT))
    loan.updated_at = datetime.now(timezone.utc)
    db.add(
        AuditLog(
            actor_id=loan.applicant_id,
            loan_application_id=loan.id,
            action="loan.pdf_generated",
            detail=f"Unsigned agreement saved to {loan.pdf_unsigned_path}",
        )
    )
    db.commit()

    return pdf_path


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _amortisation_schedule(
    principal: float,
    annual_rate_pct: float,
    months: int,
) -> list[dict]:
    """Standard reducing-balance amortisation schedule."""
    r = annual_rate_pct / 100 / 12  # monthly interest rate
    if r == 0:
        payment = principal / months
    else:
        payment = principal * r * (1 + r) ** months / ((1 + r) ** months - 1)

    payment = round(payment, 2)
    balance = principal
    today = date.today()
    rows = []

    for i in range(1, months + 1):
        interest = round(balance * r, 2)
        principal_paid = round(payment - interest, 2)
        balance = round(max(0.0, balance - principal_paid), 2)
        due_date = today + timedelta(days=30 * i)

        rows.append(
            {
                "month": i,
                "due_date": due_date.strftime("%Y-%m-%d"),
                "payment": payment,
                "principal": principal_paid,
                "interest": interest,
                "balance": balance,
            }
        )

    # Correct rounding drift on the last row
    if rows:
        rows[-1]["balance"] = 0.0

    return rows


def _render_template(
    *,
    loan: LoanApplication,
    user: User,
    schedule: list[dict],
    annual_rate_pct: float,
    monthly_payment: float,
    total_repayable: float,
    total_interest: float,
) -> str:
    template = _jinja_env.get_template("loan_agreement.html")
    return template.render(
        loan=loan,
        user=user,
        borrower_name=user.full_name or user.email,
        borrower_id_number=None,           # populated after document signing flow
        issue_date=date.today().strftime("%d %B %Y"),
        schedule=schedule,
        annual_rate_pct=annual_rate_pct,
        monthly_payment=monthly_payment,
        total_repayable=round(total_repayable, 2),
        total_interest=round(total_interest, 2),
    )


def _write_pdf(loan_id: int, html_content: str) -> Path:
    VAULT_UNSIGNED_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = VAULT_UNSIGNED_DIR / f"{loan_id}.pdf"
    HTML(string=html_content, base_url=str(PROJECT_ROOT)).write_pdf(str(pdf_path))
    return pdf_path

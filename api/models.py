import enum
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, Enum as SAEnum,
)
from sqlalchemy.orm import relationship
from api.database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    analyst = "analyst"
    applicant = "applicant"


class KYCStatus(str, enum.Enum):
    pending = "pending"
    verified = "verified"
    failed = "failed"


class LoanStatus(str, enum.Enum):
    pending = "pending"
    under_review = "under_review"
    approved = "approved"
    rejected = "rejected"
    disbursed = "disbursed"


class RiskTier(str, enum.Enum):
    low = "LOW"
    medium = "MEDIUM"
    high = "HIGH"
    blocked = "BLOCKED"
    manual_review = "MANUAL_REVIEW"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    role = Column(SAEnum(UserRole), default=UserRole.applicant, nullable=False)
    kyc_status = Column(SAEnum(KYCStatus), default=KYCStatus.pending, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    loan_applications = relationship("LoanApplication", back_populates="applicant")
    audit_logs = relationship("AuditLog", back_populates="actor")


class LoanApplication(Base):
    __tablename__ = "loan_applications"

    id = Column(Integer, primary_key=True, index=True)
    applicant_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Float, nullable=False)
    term_months = Column(Integer, nullable=False)
    purpose = Column(String(500), nullable=True)
    status = Column(SAEnum(LoanStatus), default=LoanStatus.pending, nullable=False)
    notes = Column(Text, nullable=True)
    # Risk scoring fields — populated by the AI risk engine after submission
    trust_score = Column(Integer, nullable=True)
    risk_tier = Column(SAEnum(RiskTier), nullable=True)
    risk_narrative = Column(Text, nullable=True)
    submitted_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    applicant = relationship("User", back_populates="loan_applications")
    audit_logs = relationship("AuditLog", back_populates="loan_application")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    loan_application_id = Column(Integer, ForeignKey("loan_applications.id"), nullable=True)
    action = Column(String(255), nullable=False)
    detail = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    actor = relationship("User", back_populates="audit_logs")
    loan_application = relationship("LoanApplication", back_populates="audit_logs")

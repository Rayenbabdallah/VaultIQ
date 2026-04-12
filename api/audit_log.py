"""
Audit log endpoint — VaultIQ

GET /audit-log
  Returns all AuditLog events as structured JSON.
  Requires a valid JWT with role=admin or role=analyst.
  Supports optional filtering by loan_id, actor_id, and action substring.
  Supports pagination via limit/offset query parameters.
"""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.auth import require_role
from api.database import get_db
from api.models import AuditLog

router = APIRouter(prefix="/audit-log", tags=["admin"])


@router.get(
    "",
    summary="List audit log events (admin / analyst only)",
    responses={
        403: {"description": "Insufficient role"},
        401: {"description": "Missing or invalid JWT"},
    },
)
def list_audit_log(
    payload: Annotated[dict, Depends(require_role("admin", "analyst"))],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(100, ge=1, le=1000, description="Max events to return"),
    offset: int = Query(0, ge=0, description="Number of events to skip"),
    loan_id: Optional[int] = Query(None, description="Filter by loan application ID"),
    actor_id: Optional[int] = Query(None, description="Filter by actor user ID"),
    action: Optional[str] = Query(None, description="Filter by action substring (case-insensitive)"),
):
    """
    Return a paginated list of audit log events, newest first.

    **Roles required:** `admin` or `analyst`

    **Filtering:** combine `loan_id`, `actor_id`, and `action` freely.
    `action` is a case-insensitive substring match (e.g. `action=kyc` matches `kyc.verified`).
    """
    q = db.query(AuditLog)

    if loan_id is not None:
        q = q.filter(AuditLog.loan_application_id == loan_id)
    if actor_id is not None:
        q = q.filter(AuditLog.actor_id == actor_id)
    if action:
        q = q.filter(AuditLog.action.ilike(f"%{action.strip()}%"))

    total = q.count()
    logs  = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "total":  total,
        "offset": offset,
        "limit":  limit,
        "events": [
            {
                "id":                   log.id,
                "actor_id":             log.actor_id,
                "loan_application_id":  log.loan_application_id,
                "action":               log.action,
                "detail":               log.detail,
                "ip_address":           log.ip_address,
                "created_at":           log.created_at.isoformat(),
            }
            for log in logs
        ],
    }

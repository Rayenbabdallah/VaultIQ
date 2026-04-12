"""
KYC verification module.

POST /kyc/verify
  - Accepts a JPEG or PNG document image (multipart upload)
  - Validates MIME type + magic bytes (guards against content-type spoofing)
  - Extracts name and ID number using Amazon Nova via Bedrock (primary)
    or pytesseract (fallback when OCR_PROVIDER=tesseract or Bedrock is unavailable)
  - Matches extracted fields against data/users.json registry
  - On success: sets User.kyc_status = "verified", writes AuditLog, issues JWT
  - On failure: returns structured error with a reason code
"""

import io
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from api.auth import create_access_token
from api.bedrock import BedrockExtractionError, ExtractedIdentity, extract_identity_from_image
from api.database import get_db
from api.models import AuditLog, KYCStatus, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/kyc", tags=["kyc"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGISTRY_PATH = Path(__file__).parent.parent / "data" / "users.json"

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png"}
MAGIC_BYTES: dict[bytes, str] = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


class FailureCode:
    INVALID_FILE_TYPE   = "INVALID_FILE_TYPE"
    FILE_TOO_LARGE      = "FILE_TOO_LARGE"
    OCR_EXTRACTION_FAIL = "OCR_EXTRACTION_FAIL"
    REGISTRY_MISMATCH   = "REGISTRY_MISMATCH"
    USER_NOT_FOUND      = "USER_NOT_FOUND"
    ALREADY_VERIFIED    = "ALREADY_VERIFIED"


# ---------------------------------------------------------------------------
# File validation
# ---------------------------------------------------------------------------

def _detect_mime(header: bytes) -> str | None:
    for magic, mime in MAGIC_BYTES.items():
        if header.startswith(magic):
            return mime
    return None


def _validate_upload(file: UploadFile, raw: bytes) -> None:
    """Raise HTTPException if the file fails size or MIME checks."""
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "code": FailureCode.FILE_TOO_LARGE,
                "reason": "File exceeds 10 MB limit.",
            },
        )
    detected = _detect_mime(raw[:16])
    declared = file.content_type
    if detected is None or declared not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={
                "code": FailureCode.INVALID_FILE_TYPE,
                "reason": "Only JPEG and PNG images are accepted.",
            },
        )
    if detected != declared:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={
                "code": FailureCode.INVALID_FILE_TYPE,
                "reason": "Declared Content-Type does not match file signature.",
            },
        )


# ---------------------------------------------------------------------------
# OCR extraction — Nova primary, tesseract fallback
# ---------------------------------------------------------------------------

def _use_nova() -> bool:
    provider = os.getenv("OCR_PROVIDER", "nova").lower()
    return provider != "tesseract"


def _extract_with_nova(raw: bytes, mime_type: str) -> ExtractedIdentity:
    return extract_identity_from_image(raw, mime_type)


def _extract_with_tesseract(raw: bytes) -> ExtractedIdentity:
    """
    Fallback: pytesseract + regex.
    Expects document text to contain lines like:
      Name: Alice Martin
      ID: ID-001-ALPHA
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "pytesseract / Pillow not installed. "
            "Install them or set OCR_PROVIDER=nova."
        ) from exc

    image = Image.open(io.BytesIO(raw))
    text = pytesseract.image_to_string(image)

    name_match = re.search(r"(?i)name\s*[:\-]\s*(.+)", text)
    id_match   = re.search(r"(?i)\bID\s*[:\-]\s*([\w\-]+)", text)

    return ExtractedIdentity(
        full_name=name_match.group(1).strip() if name_match else None,
        id_number=id_match.group(1).strip()   if id_match   else None,
        raw_response=text,
    )


def _extract_identity(raw: bytes, mime_type: str) -> ExtractedIdentity:
    """
    Try Nova first; fall back to tesseract on error (unless OCR_PROVIDER=nova,
    in which case Bedrock failures propagate as OCR_EXTRACTION_FAIL).
    """
    if _use_nova():
        try:
            return _extract_with_nova(raw, mime_type)
        except BedrockExtractionError as exc:
            logger.warning("Nova extraction failed (%s); falling back to tesseract.", exc)
            # Only fall back automatically when provider is not explicitly locked to nova
            if os.getenv("OCR_PROVIDER", "nova").lower() == "nova":
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "code": FailureCode.OCR_EXTRACTION_FAIL,
                        "reason": f"Document analysis failed: {exc}",
                    },
                ) from exc
            return _extract_with_tesseract(raw)

    return _extract_with_tesseract(raw)


# ---------------------------------------------------------------------------
# Registry matching
# ---------------------------------------------------------------------------

def _load_registry() -> list[dict]:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _match_registry(full_name: str, id_number: str) -> dict | None:
    """Case-insensitive match on both name and ID number."""
    for entry in _load_registry():
        if (
            entry["full_name"].lower() == full_name.lower()
            and entry["id_number"].lower() == id_number.lower()
        ):
            return entry
    return None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/verify", status_code=status.HTTP_200_OK)
async def verify_kyc(
    request: Request,
    file: UploadFile,
    db: Annotated[Session, Depends(get_db)],
):
    """
    Upload an identity document image (JPEG or PNG) for KYC verification.

    **Flow:**
    1. Validate file type via magic bytes
    2. Extract identity fields with Amazon Nova (or tesseract fallback)
    3. Match against the user registry
    4. Update DB + write audit log
    5. Return a 15-minute JWT with `kyc_status: verified`

    **Error codes:** `INVALID_FILE_TYPE` · `FILE_TOO_LARGE` · `OCR_EXTRACTION_FAIL`
    · `REGISTRY_MISMATCH` · `USER_NOT_FOUND` · `ALREADY_VERIFIED`
    """
    raw = await file.read()

    # 1. File validation
    _validate_upload(file, raw)

    # 2. Identity extraction
    identity = _extract_identity(raw, file.content_type)
    if not identity.full_name or not identity.id_number:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": FailureCode.OCR_EXTRACTION_FAIL,
                "reason": "Could not extract name and ID number from the document.",
                "extracted": {
                    "full_name": identity.full_name,
                    "id_number": identity.id_number,
                },
            },
        )

    # 3. Registry match
    registry_entry = _match_registry(identity.full_name, identity.id_number)
    if registry_entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": FailureCode.REGISTRY_MISMATCH,
                "reason": "Extracted identity does not match any record in the registry.",
            },
        )

    # 4. DB lookup
    user: User | None = (
        db.query(User).filter(User.email == registry_entry["email"]).first()
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": FailureCode.USER_NOT_FOUND,
                "reason": "No account found for this identity.",
            },
        )
    if user.kyc_status == KYCStatus.verified:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": FailureCode.ALREADY_VERIFIED,
                "reason": "This user is already KYC-verified.",
            },
        )

    # 5. Persist
    user.kyc_status = KYCStatus.verified
    user.updated_at = datetime.now(timezone.utc)
    db.add(
        AuditLog(
            actor_id=user.id,
            action="kyc.verified",
            detail=(
                f"KYC verified via Nova OCR. "
                f"id_number={identity.id_number}"
            ),
            ip_address=request.client.host if request.client else None,
        )
    )
    db.commit()

    # 6. Issue JWT
    token = create_access_token(
        subject=str(user.id),
        extra_claims={
            "user_id": user.id,
            "kyc_status": KYCStatus.verified.value,
            "role": user.role.value,
        },
    )

    return {
        # Standard OAuth2 fields
        "access_token": token,
        "token_type": "bearer",
        # Convenience aliases used by the frontend
        "token": token,
        "user_id": user.id,
        "name": user.full_name,
        "doc_id": identity.id_number,
        "kyc_status": KYCStatus.verified.value,
    }

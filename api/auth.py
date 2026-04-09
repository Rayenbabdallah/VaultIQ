import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# ---------------------------------------------------------------------------
# Key loading
# ---------------------------------------------------------------------------

CERTS_DIR = Path(__file__).parent.parent / "certs"
PRIVATE_KEY_PATH = CERTS_DIR / "leaf.key.pem"
PUBLIC_KEY_PATH = CERTS_DIR / "leaf.cert.pem"

ALGORITHM = "RS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15


def _load_private_key() -> bytes:
    path = Path(os.getenv("JWT_PRIVATE_KEY_PATH", str(PRIVATE_KEY_PATH)))
    return path.read_bytes()


def _load_public_key() -> bytes:
    """Load the public key from the leaf certificate PEM file."""
    path = Path(os.getenv("JWT_PUBLIC_CERT_PATH", str(PUBLIC_KEY_PATH)))
    raw = path.read_bytes()
    # If it's a full certificate, extract the public key
    if b"CERTIFICATE" in raw:
        from cryptography.x509 import load_pem_x509_certificate
        cert = load_pem_x509_certificate(raw, default_backend())
        return cert.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    return raw


# ---------------------------------------------------------------------------
# Token creation & validation
# ---------------------------------------------------------------------------

def create_access_token(subject: str, extra_claims: Optional[dict] = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        **(extra_claims or {}),
    }
    private_key = _load_private_key()
    return jwt.encode(payload, private_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    public_key = _load_public_key()
    try:
        return jwt.decode(token, public_key, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# FastAPI dependency — Bearer token middleware
# ---------------------------------------------------------------------------

_bearer_scheme = HTTPBearer(auto_error=True)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> dict:
    """Dependency that validates the Bearer JWT and returns its decoded payload."""
    return decode_access_token(credentials.credentials)


def require_role(*roles: str):
    """Factory for role-checking dependencies."""

    def _check(payload: dict = Depends(get_current_user)) -> dict:
        user_role = payload.get("role")
        if user_role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role(s): {roles}. Your role: {user_role}",
            )
        return payload

    return _check

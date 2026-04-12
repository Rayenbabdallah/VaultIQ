import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv()

logger = logging.getLogger(__name__)

# Configure tesseract binary path (fallback OCR — Windows requires explicit path)
_tesseract_cmd = os.getenv("TESSERACT_CMD")
if _tesseract_cmd:
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = _tesseract_cmd


@asynccontextmanager
async def lifespan(app: FastAPI):
    from api.database import init_db
    init_db()
    yield


app = FastAPI(
    title="VaultIQ",
    description="Intelligent loan application and risk assessment platform.",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow frontend origins (configurable via CORS_ORIGINS env var)
# ---------------------------------------------------------------------------

_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global error handlers
# ---------------------------------------------------------------------------

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    """Return a consistently structured 422 for Pydantic / query-param validation failures."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "VALIDATION_ERROR",
            "detail": exc.errors(),
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all: log the traceback and return a generic 500 — never leak internals."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "INTERNAL_SERVER_ERROR",
            "detail": "An unexpected error occurred. Please try again later.",
        },
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health", tags=["system"])
def health_check():
    return {"status": "ok", "service": "VaultIQ", "version": "0.1.0"}


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
from api.kyc           import router as kyc_router           # noqa: E402
from api.loans         import router as loans_router         # noqa: E402
from api.verifier      import router as verifier_router      # noqa: E402
from api.audit_log     import router as audit_log_router     # noqa: E402

app.include_router(kyc_router)
app.include_router(loans_router)
app.include_router(verifier_router)
app.include_router(audit_log_router)

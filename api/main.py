import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health", tags=["system"])
def health_check():
    return {"status": "ok", "service": "VaultIQ"}


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
from api.kyc import router as kyc_router      # noqa: E402
from api.loans import router as loans_router  # noqa: E402

app.include_router(kyc_router)
app.include_router(loans_router)

# from api.routers import users
# app.include_router(users.router, prefix="/users", tags=["users"])

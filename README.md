# VaultIQ

Intelligent loan application and risk assessment platform.

## Prerequisites

- Python 3.12+
- Docker & Docker Compose (optional)

## Local Setup

### 1. Clone & install dependencies

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set AWS credentials and BEDROCK_MODEL_ID
```

### 3. Generate development certificates

The JWT middleware uses RS256 with a self-signed leaf certificate.

```bash
python certs/generate_certs.py
```

This writes four files into `certs/`:

| File | Purpose |
|---|---|
| `ca.cert.pem` | CA certificate |
| `ca.key.pem` | CA private key |
| `leaf.cert.pem` | Leaf certificate (JWT public key source) |
| `leaf.key.pem` | Leaf private key (JWT signing key) |

> These files are git-ignored. Regenerate them per environment — never share private keys.

### 4. Run the API

```bash
uvicorn api.main:app --reload
```

API is available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

## Docker

```bash
# Build and start
docker-compose up --build

# Health check
curl http://localhost:8000/health
```

> Mount pre-generated certs into the container via the `certs/` volume defined in `docker-compose.yml`.

## Project Structure

```
VaultIQ/
├── api/
│   ├── __init__.py
│   ├── main.py        # FastAPI app, lifespan, CORS, routers
│   ├── auth.py        # RS256 JWT issuance + Bearer middleware
│   ├── database.py    # SQLAlchemy engine, session, Base
│   └── models.py      # User, LoanApplication, AuditLog
├── certs/
│   └── generate_certs.py   # Generates CA + leaf cert/key pairs
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
└── requirements.txt
```

## Auth Flow

1. Issue a token (to be implemented in a `/auth/token` route):
   ```python
   from api.auth import create_access_token
   token = create_access_token(subject=str(user.id), extra_claims={"role": user.role})
   ```

2. Protected routes use the `get_current_user` dependency:
   ```python
   from api.auth import get_current_user
   @router.get("/me")
   def me(payload: dict = Depends(get_current_user)):
       return payload
   ```

3. Role-gated routes use `require_role`:
   ```python
   from api.auth import require_role
   @router.get("/admin")
   def admin_only(payload: dict = Depends(require_role("admin"))):
       ...
   ```

Tokens expire after **15 minutes**. Algorithm: **RS256**.

## Database Models

| Model | Key Fields |
|---|---|
| `User` | id, email, hashed_password, role (admin/analyst/applicant), is_active |
| `LoanApplication` | id, applicant_id (FK), amount, term_months, purpose, status |
| `AuditLog` | id, actor_id (FK), loan_application_id (FK), action, detail, ip_address |

SQLite is used by default (`DB_PATH` in `.env`). The schema is created automatically on startup via `init_db()`.

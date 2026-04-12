# VaultIQ

Intelligent loan application and risk assessment platform — FastAPI · React · Amazon Bedrock Nova · PAdES/XAdES.

---

## Repository Structure

```
VaultIQ/
├── api/
│   ├── main.py            # FastAPI app, CORS, global error handlers, routers
│   ├── auth.py            # RS256 JWT issuance + Bearer dependency
│   ├── database.py        # SQLAlchemy engine, session factory, init_db()
│   ├── models.py          # User, LoanApplication, AuditLog SQLAlchemy models
│   ├── kyc.py             # POST /kyc/verify — OCR identity verification
│   ├── bedrock.py         # Amazon Nova (Bedrock Converse API) — OCR + risk scoring
│   ├── risk_engine.py     # score_borrower() orchestrator
│   ├── loans.py           # POST /loans/apply, sign, download endpoints
│   ├── pdf_generator.py   # Jinja2 + WeasyPrint loan agreement PDF
│   ├── signer.py          # PAdES-B, PAdES-T (RFC 3161), XAdES-T signing pipeline
│   ├── verifier.py        # POST /verify — pyHanko PDF + lxml/cryptography XML
│   └── audit_log.py       # GET /audit-log (admin/analyst JWT)
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── BorrowerFlow.jsx   # 4-step loan application wizard
│   │   │   └── AdminDashboard.jsx # Compliance verification dashboard
│   │   └── components/
│   │       ├── TrustScoreMeter.jsx
│   │       └── StepIndicator.jsx
│   ├── Dockerfile         # Multi-stage Node build → nginx serve
│   └── nginx.conf         # SPA fallback + API proxy to api:8000
├── templates/
│   └── loan_agreement.html   # Jinja2 PDF template
├── certs/
│   └── generate_certs.py     # Generates self-signed CA + leaf cert/key
├── data/
│   └── users.json            # KYC identity registry (3 sample entries)
├── scripts/
│   └── demo_seed.py          # Seeds DB with test users + sample loan
├── vault/
│   ├── unsigned/             # Generated unsigned PDFs
│   └── signed/               # PAdES-B, PAdES-T, XAdES-T artifacts
├── .env.example
├── docker-compose.yml        # api (port 8000) + frontend/nginx (port 3000)
├── Dockerfile                # FastAPI container
└── requirements.txt
```

---

## Prerequisites

| Dependency | Version | Notes |
|---|---|---|
| Python | 3.12+ | 3.13/3.14 supported |
| Node.js | 20+ | For frontend dev server |
| Docker + Compose | v2+ | For containerised deployment |
| AWS account | — | IAM user with `bedrock:InvokeModel` permission |
| Tesseract (optional) | 5.x | Windows fallback OCR — [installer](https://github.com/UB-Mannheim/tesseract/wiki) |

> **Windows / WeasyPrint:** install [GTK3 for Windows](https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases) and ensure it is on `PATH`.

---

## Local Setup (without Docker)

### 1. Clone and create virtual environment

```bash
git clone <repo-url>
cd VaultIQ
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# AWS Bedrock credentials
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=amazon.nova-lite-v1:0

# OCR provider: "nova" (Bedrock) or "tesseract" (local fallback)
OCR_PROVIDER=nova

# Windows tesseract path (only needed when OCR_PROVIDER=tesseract)
# TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe

# Loan settings
LOAN_ANNUAL_RATE_PCT=8.0

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

### 3. Generate certificates

```bash
python certs/generate_certs.py
```

Writes to `certs/`: `ca.cert.pem`, `ca.key.pem`, `leaf.cert.pem`, `leaf.key.pem`.  
These files are git-ignored — regenerate per environment, never commit private keys.

### 4. Seed the database

```bash
python scripts/demo_seed.py
```

Creates two users (applicant + admin) and a sample pre-scored loan. Prints demo JWT tokens.

### 5. Start the API

```bash
uvicorn api.main:app --reload
```

- API: `http://localhost:8000`
- Interactive docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/health`

### 6. Start the frontend (optional)

```bash
cd frontend
npm install
npm run dev
```

- Frontend: `http://localhost:5173`

---

## Docker Compose (recommended)

```bash
# 1. Generate certs first (one-time, outside Docker)
python certs/generate_certs.py

# 2. Configure .env
cp .env.example .env && nano .env

# 3. Build and start everything
docker compose up --build

# Services:
#   API      → http://localhost:8000
#   Frontend → http://localhost:3000
```

To run only the API:

```bash
docker compose up api
```

To seed the database inside the running container:

```bash
docker compose exec api python scripts/demo_seed.py
```

---

## Demo Walkthrough (10 Steps)

The following sequence matches the grading / demo script exactly. Replace tokens and IDs from the responses of each step.

### Step 1 — Health check

```bash
curl http://localhost:8000/health
# → {"status":"ok","service":"VaultIQ","version":"0.1.0"}
```

### Step 2 — Seed the database

```bash
python scripts/demo_seed.py
# Prints APPLICANT_TOKEN and ADMIN_TOKEN — copy them
```

> **Or** use the KYC flow (Step 3 below) to obtain a fresh token from an uploaded ID image.

### Step 3 — KYC verification (upload ID image)

```bash
curl -X POST http://localhost:8000/kyc/verify \
  -F "file=@/path/to/id_image.jpg"
# → {"access_token":"...","token":"...","name":"Alice Martin","doc_id":"ID-001-ALPHA","kyc_status":"verified",...}
export TOKEN=<token from response>
```

> The image must contain `Name: Alice Martin` and `ID: ID-001-ALPHA` (or Bob Nguyen / Clara Osei — see `data/users.json`).  
> With `OCR_PROVIDER=nova` this uses Amazon Nova multimodal vision.  
> With `OCR_PROVIDER=tesseract` it falls back to pytesseract + regex.

### Step 4 — Submit a loan application

```bash
curl -X POST http://localhost:8000/loans/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 15000, "purpose": "Home Improvement", "duration_months": 36}'
# → {"loan_id":1,"amount":15000.0,"trust_score":78,"risk_tier":"MEDIUM",...}
export LOAN_ID=<loan_id from response>
```

Returns **201** (LOW/MEDIUM), **202** (HIGH/MANUAL_REVIEW), or **403** (BLOCKED).

### Step 5 — Check the AI risk narrative

The `risk_narrative` field in the loan apply response contains the plain-English explanation generated by Amazon Nova.

### Step 6 — Download the unsigned agreement

```bash
curl -OJ http://localhost:8000/loans/$LOAN_ID/download-unsigned \
  -H "Authorization: Bearer $TOKEN"
# → VaultIQ_LoanAgreement_00001_UNSIGNED.pdf
```

### Step 7 — Sign the agreement (PAdES-B → PAdES-T → XAdES-T)

```bash
curl -X POST http://localhost:8000/loans/$LOAN_ID/sign \
  -H "Authorization: Bearer $TOKEN"
# → {"loan_id":1,"pades_b":{...},"pades_t":{...},"xades_t":{...}}
```

Three artifacts are written to `vault/signed/`:
- `{id}_pades_b.pdf` — CAdES-detached signature (ETSI EN 319 122)
- `{id}_pades_t.pdf` — PAdES-B + RFC 3161 document timestamp (freetsa.org)
- `{id}_xades.xml`   — Detached XAdES-T XML signature + timestamp

### Step 8 — Download the signed agreement

```bash
curl -OJ http://localhost:8000/loans/$LOAN_ID/download-signed \
  -H "Authorization: Bearer $TOKEN"
# → VaultIQ_LoanAgreement_00001_SIGNED.pdf
```

### Step 9 — Verify the signed document

```bash
# Verify the PAdES-T PDF
curl -X POST http://localhost:8000/verify \
  -F "file=@vault/signed/${LOAN_ID}_pades_t.pdf"

# Verify the XAdES-T XML
curl -X POST http://localhost:8000/verify \
  -F "file=@vault/signed/${LOAN_ID}_xades.xml"
# → {"overall_verdict":"VALID","signature_valid":true,"cert_trusted":true,...}
```

### Step 10 — Inspect the audit log

```bash
# Requires admin token from demo_seed.py
curl http://localhost:8000/audit-log \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → {"total":N,"events":[{"action":"kyc.verified",...},{"action":"loan.submitted",...},{"action":"risk.scored",...},...]}

# Filter by loan
curl "http://localhost:8000/audit-log?loan_id=$LOAN_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET`  | `/health` | none | Liveness check |
| `POST` | `/kyc/verify` | none | Upload ID image → KYC + JWT |
| `POST` | `/loans/apply` | Bearer (kyc=verified) | Submit loan application |
| `GET`  | `/loans/{id}/download-unsigned` | Bearer | Download unsigned PDF |
| `POST` | `/loans/{id}/sign` | Bearer | Run PAdES-B→T→XAdES-T pipeline |
| `GET`  | `/loans/{id}/download-signed` | Bearer | Download PAdES-T PDF |
| `POST` | `/verify` | none | Verify PDF (PAdES) or XML (XAdES) |
| `GET`  | `/audit-log` | Bearer (admin/analyst) | List all audit events |

Full OpenAPI spec: `http://localhost:8000/docs`

---

## Audit Log Actions

| Action | Trigger |
|---|---|
| `kyc.verified` | Successful KYC identity match |
| `loan.submitted` | New loan application created |
| `risk.scored` | AI risk engine returns a score |
| `loan.pdf_generated` | Unsigned PDF written to disk |
| `loan.pades_b_signed` | PAdES-B signature applied |
| `loan.pades_t_signed` | RFC 3161 timestamp applied |
| `loan.xades_t_generated` | XAdES-T XML produced |
| `loan.document_downloaded` | Unsigned or signed PDF downloaded |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | — | AWS credentials for Bedrock |
| `AWS_SECRET_ACCESS_KEY` | — | AWS credentials for Bedrock |
| `AWS_REGION` | `us-east-1` | Bedrock region |
| `BEDROCK_MODEL_ID` | `amazon.nova-lite-v1:0` | Nova model ID |
| `OCR_PROVIDER` | `nova` | `nova` or `tesseract` |
| `TESSERACT_CMD` | — | Full path to `tesseract.exe` (Windows) |
| `LOAN_ANNUAL_RATE_PCT` | `8.0` | Base interest rate for amortisation |
| `TSA_URL` | `https://freetsa.org/tsr` | RFC 3161 timestamp authority |
| `DB_PATH` | `vaultiq.db` | SQLite database path |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Comma-separated allowed origins |
| `JWT_PRIVATE_KEY_PATH` | `certs/leaf.key.pem` | RS256 signing key |
| `JWT_PUBLIC_CERT_PATH` | `certs/leaf.cert.pem` | RS256 public cert |

---

## Security Notes

- JWTs use **RS256** with a self-signed leaf certificate. Generate fresh certs per environment.
- KYC files are validated by **magic bytes** (not Content-Type header alone) — guards against MIME spoofing.
- The risk engine **never auto-approves** — any failure defaults to `MANUAL_REVIEW`.
- The `/audit-log` endpoint requires `admin` or `analyst` role — never expose it without authentication.
- PDFs are timestamped via **freetsa.org** (free public TSA). Use a qualified TSA for production.
- Private keys (`certs/*.pem`) and `.env` are git-ignored. Never commit them.

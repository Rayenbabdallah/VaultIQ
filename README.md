# VaultIQ — Intelligent Loan Compliance Platform

> FastAPI · React · Amazon Bedrock Nova · PAdES/XAdES · RFC 3161

---

## Table of Contents

1. [Main Concepts](#1-main-concepts)
2. [Existing Solutions Overview](#2-existing-solutions-overview)
3. [High Level Design](#3-high-level-design)
4. [Tools & Development Phases](#4-tools--development-phases)
5. [Executable Deliverable](#5-executable-deliverable)
6. [Repository Structure](#6-repository-structure)
7. [API Reference](#7-api-reference)
8. [Demo Walkthrough](#8-demo-walkthrough)

---

## 1. Main Concepts

### 1.1 What is VaultIQ?

VaultIQ is a **Compliance-as-a-Service** platform that automates the end-to-end lifecycle of a loan application — from identity verification through AI-based risk scoring to legally binding digital signature — while maintaining a tamper-proof audit trail of every action.

### 1.2 Key Concepts

#### Know Your Customer (KYC)
KYC is the regulatory process by which a financial institution verifies the identity of a client before establishing a business relationship. VaultIQ automates KYC using **multimodal AI (Amazon Nova)** to extract name and ID number from an uploaded identity document, then cross-references the extracted data against a trusted registry.

#### AI-Based Risk Scoring
Once identity is confirmed, the platform scores the borrower using a **Large Language Model (Amazon Nova via AWS Bedrock)**. The model receives loan parameters (amount, duration, purpose) and returns:
- A **trust score** (0–100)
- A **risk tier**: `LOW`, `MEDIUM`, `HIGH`, `MANUAL_REVIEW`, or `BLOCKED`
- A plain-English **narrative** explaining the decision

This replaces manual underwriting with explainable, consistent, auditable AI decisions.

#### Digital Signatures — PAdES & XAdES
A digital signature proves that a document was signed by a specific key holder and has not been modified since signing. VaultIQ applies **three signature layers**:

| Level | Standard | What it guarantees |
|-------|----------|--------------------|
| PAdES-B | ETSI EN 319 122 | Cryptographic proof of signer identity |
| PAdES-T | ETSI EN 319 122 + RFC 3161 | PAdES-B + trusted timestamp (document existed at a point in time) |
| XAdES-T | ETSI EN 319 132 | Detached XML signature + timestamp over the PDF artifact |

#### RFC 3161 — Trusted Timestamping
An RFC 3161 timestamp is a cryptographic proof from a **Time Stamp Authority (TSA)** that a specific document hash existed at a specific time. VaultIQ uses **freetsa.org** as the TSA. In production, a qualified TSA (e.g. DigiCert, GlobalSign) would be used.

#### RS256 JSON Web Tokens
After KYC, the platform issues a **JWT signed with RSA-256** containing the user's identity, role, and `kyc_status`. All subsequent API calls carry this token. The private key never leaves the server; the public certificate is used for verification.

#### Audit Trail
Every significant event (KYC, loan submission, risk scoring, signing, download) is written as an immutable row in the `audit_log` table with actor, timestamp, IP address, and a structured detail string. Admins can query this log via the `/audit-log` endpoint.

### 1.3 Functional Flow

```
User                    API                        External Services
 │                       │                               │
 │── Upload ID image ────▶│                               │
 │                       │── Amazon Nova OCR ────────────▶│
 │                       │◀─ extracted name + ID ─────────│
 │                       │── Registry match               │
 │                       │── Issue RS256 JWT              │
 │◀── JWT + identity ─────│                               │
 │                       │                               │
 │── POST /loans/apply ──▶│                               │
 │   (amount, purpose,    │── Amazon Nova risk score ─────▶│
 │    duration, JWT)      │◀─ trust_score + narrative ─────│
 │                       │── Store loan + score in DB     │
 │◀── risk result ─────── │                               │
 │                       │                               │
 │── POST /loans/{id}/sign▶│                               │
 │                       │── WeasyPrint → unsigned PDF    │
 │                       │── pyHanko PAdES-B signature    │
 │                       │── RFC 3161 timestamp ──────────▶│
 │                       │◀─ TST token ───────────────────│
 │                       │── PAdES-T upgrade              │
 │                       │── XAdES-T XML generation       │
 │◀── signed PDF paths ───│                               │
 │                       │                               │
 │── POST /verify ───────▶│                               │
 │                       │── pyHanko async validation     │
 │                       │── Extract cert chain + TST     │
 │◀── verification report │                               │
```

---

## 2. Existing Solutions Overview

| Solution | Type | Strengths | Limitations |
|----------|------|-----------|-------------|
| **DocuSign** | Commercial e-signature | Widely adopted, legally recognised, integrations | No AI risk scoring, no KYC, expensive |
| **Adobe Acrobat Sign** | Commercial e-signature | PDF-native, enterprise support | No loan-specific logic, no AI, no open-source |
| **Temenos Infinity** | Core banking platform | Full loan lifecycle, regulatory compliance | Monolithic, expensive, no AI-native risk engine |
| **Mambu** | Cloud banking SaaS | Modern API-first, flexible | No built-in digital signing, no explainable AI |
| **Finastra** | Financial services suite | KYC modules, compliance tools | Heavy enterprise setup, no open-source path |
| **Open eSignForms** | Open-source e-signature | Free, self-hosted | No AI, no KYC, no PAdES/XAdES compliance |
| **VaultIQ** (this project) | Open-source, AI-native | End-to-end: KYC + AI scoring + PAdES/XAdES + audit | Demo/academic scope — single-tenant SQLite |

**VaultIQ's differentiator**: it is the only fully open-source solution that combines KYC via multimodal AI, explainable LLM-based risk scoring, and legally structured digital signatures (PAdES-T + XAdES-T) in a single deployable platform.

---

## 3. High Level Design

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Docker Compose                        │
│                                                           │
│  ┌─────────────────────┐     ┌─────────────────────────┐ │
│  │   Frontend (nginx)  │     │    API (FastAPI/uvicorn) │ │
│  │   React + Vite      │────▶│    port 8000             │ │
│  │   port 3000         │     │                         │ │
│  └─────────────────────┘     │  ┌──────────────────┐   │ │
│                               │  │  kyc.py          │   │ │
│                               │  │  loans.py        │   │ │
│                               │  │  signer.py       │   │ │
│                               │  │  verifier.py     │   │ │
│                               │  │  risk_engine.py  │   │ │
│                               │  │  audit_log.py    │   │ │
│                               │  └──────────────────┘   │ │
│                               │         │               │ │
│                               │  ┌──────▼───────────┐   │ │
│                               │  │  SQLite DB        │   │ │
│                               │  │  (Docker volume)  │   │ │
│                               │  └──────────────────┘   │ │
│                               └───────────┬─────────────┘ │
└───────────────────────────────────────────┼───────────────┘
                                            │
                    ┌───────────────────────┼────────────────┐
                    │                       │                │
             ┌──────▼──────┐        ┌──────▼──────┐  ┌──────▼──────┐
             │  AWS Bedrock │        │  freetsa.org │  │  certs/     │
             │  Amazon Nova │        │  RFC 3161    │  │  RS256 PKI  │
             │  (OCR + AI)  │        │  TSA         │  │             │
             └─────────────┘        └─────────────┘  └─────────────┘
```

### 3.2 Component Descriptions

| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| **Frontend** | React 18, Vite, Tailwind CSS | 4-step borrower wizard, compliance admin dashboard |
| **nginx** | nginx 1.27 | SPA fallback routing, reverse proxy to API |
| **API** | FastAPI 0.115, Python 3.12 | REST endpoints, business logic orchestration |
| **KYC module** | `api/kyc.py` | File validation, Nova OCR, registry match, JWT issuance |
| **Risk Engine** | `api/risk_engine.py` + `api/bedrock.py` | Calls Amazon Nova, parses score + narrative |
| **PDF Generator** | WeasyPrint + Jinja2 | Renders HTML template → unsigned PDF |
| **Signer** | pyHanko + asn1crypto | PAdES-B → PAdES-T → XAdES-T pipeline |
| **Verifier** | pyHanko + lxml + cryptography | Validates PAdES and XAdES signatures |
| **Database** | SQLAlchemy + SQLite | Users, LoanApplications, AuditLog |
| **Auth** | `api/auth.py` | RS256 JWT issuance and validation |

### 3.3 Data Models

```
User
├── id, email, hashed_password, full_name
├── role: [applicant | admin | analyst]
├── kyc_status: [pending | verified | rejected]
└── is_active, created_at, updated_at

LoanApplication
├── id, applicant_id (FK → User)
├── amount, term_months, purpose
├── status: [pending | approved | rejected | under_review]
├── trust_score (0–100), risk_tier
├── risk_narrative (AI-generated text)
├── pdf_unsigned_path, pdf_pades_b_path
├── pdf_pades_t_path, xml_xades_t_path
└── created_at, updated_at

AuditLog
├── id, actor_id (FK → User)
├── loan_application_id (FK → LoanApplication, nullable)
├── action (enum: kyc.verified | loan.submitted | ...)
├── detail (free text)
├── ip_address, created_at
```

### 3.4 Key Message Flows

#### KYC Flow
```
POST /kyc/verify  (multipart: file)
  1. Magic-byte validation (JPEG/PNG only)
  2. File size check (≤ 10 MB)
  3. Amazon Nova Converse API → ExtractedIdentity { full_name, id_number }
  4. Registry lookup in data/users.json (case-insensitive)
  5. DB lookup by email
  6. Update user.kyc_status = verified
  7. Write AuditLog(kyc.verified)
  8. Issue RS256 JWT { user_id, role, kyc_status, exp: +15min }

Response 200: { access_token, token, user_id, name, doc_id, kyc_status }
Response 404: registry mismatch or user not found
Response 409: already verified
Response 422: OCR extraction failed
```

#### Loan + Signing Flow
```
POST /loans/apply  (JSON body, Bearer JWT)
  1. Verify JWT + kyc_status == verified
  2. Validate amount (500–500,000), purpose, duration (1–360 months)
  3. Call score_borrower(amount, purpose, duration) → RiskResult
  4. Persist LoanApplication with score + tier
  5. Generate unsigned PDF (WeasyPrint)
  6. Write AuditLog(loan.submitted, risk.scored, loan.pdf_generated)

POST /loans/{id}/sign  (Bearer JWT)
  1. Load unsigned PDF from vault/unsigned/
  2. sign_pades_b() → vault/signed/{id}_pades_b.pdf
  3. sign_pades_t() → RFC 3161 token from freetsa.org
                   → vault/signed/{id}_pades_t.pdf
  4. generate_xades_t() → vault/signed/{id}_xades.xml
  5. Write AuditLog × 3 (sha256 + path per artifact)
```

---

## 4. Tools & Development Phases

### 4.1 Technology Stack

| Layer | Tool | Version | Why |
|-------|------|---------|-----|
| API framework | FastAPI | 0.115 | Async, auto-OpenAPI, Pydantic validation |
| ASGI server | Uvicorn | 0.34 | Production-grade ASGI, low overhead |
| ORM | SQLAlchemy | 2.0 | Declarative models, async-compatible |
| Database | SQLite | 3.x | Zero-config, sufficient for demo scale |
| AI / OCR | Amazon Bedrock (Nova) | nova-lite-v1 | Multimodal vision + text generation |
| PDF generation | WeasyPrint + Jinja2 | 62 / 3.1 | HTML → PDF with CSS layout |
| PDF signing | pyHanko | 0.25 | PAdES-B, PAdES-T, RFC 3161 support |
| XML signing | lxml + cryptography | 5.3 / 44 | XAdES-T detached signature |
| ASN.1 / TSP | asn1crypto | 1.5 | RFC 3161 token parsing |
| Auth | python-jose + RS256 | — | JWT issuance and validation |
| Frontend framework | React 18 + Vite | — | Component model, fast HMR |
| Styling | Tailwind CSS 3 | — | Utility-first, custom design tokens |
| HTTP client | Axios | — | Browser fetch with interceptors |
| Icons | Lucide React | — | Consistent SVG icon set |
| Containerisation | Docker + Compose v2 | — | Reproducible multi-service deployment |
| Web server | nginx 1.27 | — | Static serving + API reverse proxy |

### 4.2 Development Phases

| Phase | Description | Deliverables |
|-------|-------------|--------------|
| **Phase 1 — Core Infrastructure** | Project scaffold, DB models, auth module, Docker setup | `api/models.py`, `api/auth.py`, `api/database.py`, `Dockerfile`, `docker-compose.yml` |
| **Phase 2 — KYC Module** | ID image upload, Amazon Nova OCR integration, registry matching, JWT issuance | `api/kyc.py`, `api/bedrock.py`, `data/users.json` |
| **Phase 3 — Loan & Risk Engine** | Loan application endpoint, AI risk scoring, PDF generation | `api/loans.py`, `api/risk_engine.py`, `api/pdf_generator.py`, `templates/loan_agreement.html` |
| **Phase 4 — Digital Signatures** | PAdES-B → PAdES-T → XAdES-T pipeline, RFC 3161 timestamps | `api/signer.py`, `certs/generate_certs.py` |
| **Phase 5 — Compliance Verifier** | Signature and timestamp verification endpoint | `api/verifier.py` |
| **Phase 6 — Audit & Admin** | Audit log model + query endpoint | `api/audit_log.py` |
| **Phase 7 — Frontend** | 4-step borrower wizard, compliance admin dashboard, design system | `frontend/src/pages/`, `frontend/src/components/` |
| **Phase 8 — Integration & Hardening** | CORS, global error handlers, input sanitisation, Docker volumes, auto-seed | `api/main.py`, `entrypoint.sh`, `scripts/demo_seed.py` |

---

## 5. Executable Deliverable

### Prerequisites

| Dependency | Notes |
|---|---|
| Docker Desktop v2+ | Required — includes Compose |
| AWS account | IAM user with `bedrock:InvokeModel` on `amazon.nova-lite-v1:0` in `us-east-1` |
| Python 3.12+ (host) | Only needed to generate certs |

### Quick Start (3 commands)

```bash
# 1. Generate certificates (one-time)
python certs/generate_certs.py

# 2. Configure AWS credentials
cp .env.example .env
# Edit .env: set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION

# 3. Build and run
docker compose up --build
```

- **Borrower UI**: http://localhost:3000
- **Admin / Compliance**: http://localhost:3000/admin
- **API docs (Swagger)**: http://localhost:8000/docs

The database is seeded automatically on startup. Alice Martin starts as `kyc_status=pending` so the full 4-step flow can be demonstrated.

### Demo Test Users

| Name | ID Number | Email |
|------|-----------|-------|
| Alice Martin | ID-001-ALPHA | alice.martin@example.com |
| Bob Nguyen | ID-002-BRAVO | bob.nguyen@example.com |
| Clara Osei | ID-003-CHARLIE | clara.osei@example.com |

Test ID card images: `data/test_ids/Alice_Martin.png`, `Bob_Nguyen.png`, `Clara_Osei.png`

### Full Demo Flow (UI)

1. Open http://localhost:3000
2. **Step 1 — Identity**: upload `data/test_ids/Alice_Martin.png` → Nova OCR extracts name + ID → verified
3. **Step 2 — Loan**: enter amount (e.g. 15 000), select purpose, set duration → live payment estimator
4. **Step 3 — Risk**: AI trust score animates in → tier badge → AI narrative → click **Sign Agreement**
5. **Step 4 — Download**: download the signed PDF
6. Open http://localhost:3000/admin → upload the signed PDF → **Document Valid** banner

---

## 6. Repository Structure

```
VaultIQ/
├── api/
│   ├── main.py            # FastAPI app, CORS, global handlers, routers
│   ├── auth.py            # RS256 JWT issuance + Bearer dependency
│   ├── database.py        # SQLAlchemy engine, session factory, init_db()
│   ├── models.py          # User, LoanApplication, AuditLog models
│   ├── kyc.py             # POST /kyc/verify — OCR identity verification
│   ├── bedrock.py         # Amazon Nova (Bedrock Converse API)
│   ├── risk_engine.py     # score_borrower() orchestrator
│   ├── loans.py           # POST /loans/apply, sign, download endpoints
│   ├── pdf_generator.py   # Jinja2 + WeasyPrint loan agreement PDF
│   ├── signer.py          # PAdES-B, PAdES-T, XAdES-T signing pipeline
│   ├── verifier.py        # POST /verify — pyHanko PDF + lxml XML
│   └── audit_log.py       # GET /audit-log (admin/analyst only)
├── frontend/
│   ├── src/pages/
│   │   ├── BorrowerFlow.jsx   # 4-step loan application wizard
│   │   └── AdminDashboard.jsx # Compliance verification dashboard
│   ├── src/components/
│   │   ├── TrustScoreMeter.jsx
│   │   └── StepIndicator.jsx
│   ├── Dockerfile             # Multi-stage Node build → nginx
│   └── nginx.conf             # SPA fallback + API proxy
├── templates/
│   └── loan_agreement.html    # Jinja2 PDF template
├── certs/
│   └── generate_certs.py      # Self-signed CA + leaf cert/key
├── data/
│   ├── users.json             # KYC identity registry
│   └── test_ids/              # Sample ID card images for demo
├── scripts/
│   └── demo_seed.py           # Seeds DB with test users
├── vault/
│   ├── unsigned/              # Generated unsigned PDFs
│   └── signed/                # PAdES-B, PAdES-T, XAdES-T artifacts
├── entrypoint.sh              # Docker startup: seed + uvicorn
├── docker-compose.yml         # api (8000) + frontend/nginx (3000)
├── Dockerfile                 # FastAPI container
├── requirements.txt
└── .env.example
```

---

## 7. API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET`  | `/health` | none | Liveness check |
| `POST` | `/kyc/verify` | none | Upload ID image → KYC verification + JWT |
| `POST` | `/loans/apply` | Bearer (kyc=verified) | Submit loan, get AI risk score |
| `GET`  | `/loans/{id}/download-unsigned` | Bearer | Download unsigned PDF |
| `POST` | `/loans/{id}/sign` | Bearer | PAdES-B → PAdES-T → XAdES-T pipeline |
| `GET`  | `/loans/{id}/download-signed` | Bearer | Download PAdES-T signed PDF |
| `POST` | `/verify` | none | Verify PDF (PAdES) or XML (XAdES) |
| `GET`  | `/audit-log` | Bearer (admin/analyst) | Query audit events |

Full OpenAPI spec available at `http://localhost:8000/docs`

### Risk Tier Mapping

| Trust Score | Tier | HTTP Status | Meaning |
|-------------|------|-------------|---------|
| 75–100 | LOW | 201 | Approved — excellent profile |
| 50–74 | MEDIUM | 201 | Conditionally approved |
| 25–49 | HIGH | 202 | Elevated risk — analyst review |
| 10–24 | MANUAL_REVIEW | 202 | Flagged for human review |
| 0–9 | BLOCKED | 403 | Application declined |

---

## 8. Demo Walkthrough (API / curl)

```bash
# Health
curl http://localhost:8000/health

# KYC
curl -X POST http://localhost:8000/kyc/verify \
  -F "file=@data/test_ids/Alice_Martin.png"
export TOKEN=<token from response>

# Apply for a loan
curl -X POST http://localhost:8000/loans/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 15000, "purpose": "Home Improvement", "duration_months": 36}'
export LOAN_ID=<loan_id from response>

# Sign
curl -X POST http://localhost:8000/loans/$LOAN_ID/sign \
  -H "Authorization: Bearer $TOKEN"

# Download signed PDF
curl -OJ http://localhost:8000/loans/$LOAN_ID/download-signed \
  -H "Authorization: Bearer $TOKEN"

# Verify
curl -X POST http://localhost:8000/verify \
  -F "file=@vault/signed/${LOAN_ID}_pades_t.pdf"

# Audit log (use admin token printed by demo_seed.py)
curl http://localhost:8000/audit-log \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Security Notes

- JWTs use **RS256** — private key never transmitted, public cert used for verification only
- KYC uploads validated by **magic bytes** (not Content-Type) — guards against MIME spoofing
- The risk engine **never auto-approves** — failures default to `MANUAL_REVIEW`
- `/audit-log` requires `admin` or `analyst` role JWT
- RFC 3161 timestamps from **freetsa.org** — use a qualified TSA for production
- Private keys (`certs/*.pem`) and `.env` are git-ignored — never committed

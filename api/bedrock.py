"""
AWS Bedrock client for VaultIQ.

Wraps the boto3 Bedrock Runtime converse() API for Amazon Nova models.
Provides a typed document-extraction helper used by the KYC module.

MOCK_AI mode
------------
Set MOCK_AI=true in .env (or the environment) to skip all AWS calls and
return deterministic hardcoded responses.  This lets the full demo run
without any AWS account or credentials.

  - KYC: maps the uploaded filename to a known test identity.
         Any file whose name contains "Bob"  → Bob Nguyen  (ID-002-BRAVO)
         Any file whose name contains "Clara" → Clara Osei (ID-003-CHARLIE)
         Everything else                      → Alice Martin (ID-001-ALPHA)
  - Risk scoring: returns trust_score=82, risk_tier=LOW with a canned narrative.
"""

import json
import os
from dataclasses import dataclass
from functools import lru_cache

# boto3 is optional when running in mock mode
try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
    _BOTO3_AVAILABLE = True
except ImportError:  # pragma: no cover
    _BOTO3_AVAILABLE = False
    BotoCoreError = Exception  # type: ignore[misc,assignment]
    ClientError   = Exception  # type: ignore[misc,assignment]


def _mock_mode() -> bool:
    return os.getenv("MOCK_AI", "false").lower() in ("true", "1", "yes")


# ---------------------------------------------------------------------------
# Client singleton
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_bedrock_client():
    if not _BOTO3_AVAILABLE:
        raise BedrockExtractionError(
            "boto3 is not installed. Either install it or set MOCK_AI=true."
        )
    return boto3.client(
        "bedrock-runtime",
        region_name=os.getenv("AWS_REGION", "us-east-1"),
    )


def get_model_id() -> str:
    return os.getenv("BEDROCK_MODEL_ID", "amazon.nova-lite-v1:0")


# ---------------------------------------------------------------------------
# Document extraction
# ---------------------------------------------------------------------------

@dataclass
class ExtractedIdentity:
    full_name: str | None
    id_number: str | None
    raw_response: str = ""


_EXTRACTION_PROMPT = """You are an identity document parser.
Examine the image and extract exactly two fields:
- full_name: the person's complete name as printed on the document
- id_number: the document/ID number (may contain letters, digits, and hyphens)

Respond with ONLY a valid JSON object — no markdown, no explanation:
{"full_name": "...", "id_number": "..."}

Use null for any field you cannot find."""


_MOCK_KYC_MAP = {
    "bob":   ExtractedIdentity(full_name="Bob Nguyen",  id_number="ID-002-BRAVO",   raw_response="[mock]"),
    "clara": ExtractedIdentity(full_name="Clara Osei",  id_number="ID-003-CHARLIE", raw_response="[mock]"),
    "alice": ExtractedIdentity(full_name="Alice Martin", id_number="ID-001-ALPHA",  raw_response="[mock]"),
}


def _mock_extract_identity(filename: str) -> ExtractedIdentity:
    """Return a deterministic identity based on the uploaded filename."""
    lower = (filename or "").lower()
    for key, identity in _MOCK_KYC_MAP.items():
        if key in lower:
            return identity
    # Default to Alice if filename doesn't match any known test user
    return _MOCK_KYC_MAP["alice"]


def extract_identity_from_image(
    image_bytes: bytes,
    mime_type: str,  # "image/jpeg" or "image/png"
    filename: str = "",
) -> ExtractedIdentity:
    """
    Send the document image to Nova and parse the returned JSON.

    When MOCK_AI=true the AWS call is skipped entirely; identity is derived
    from the uploaded filename so all three demo users work without credentials.

    Raises:
        BedrockExtractionError: if the API call fails or returns unparseable output.
    """
    if _mock_mode():
        return _mock_extract_identity(filename)

    fmt = "jpeg" if mime_type == "image/jpeg" else "png"

    message = {
        "role": "user",
        "content": [
            {
                "image": {
                    "format": fmt,
                    "source": {"bytes": image_bytes},
                }
            },
            {"text": _EXTRACTION_PROMPT},
        ],
    }

    try:
        response = get_bedrock_client().converse(
            modelId=get_model_id(),
            messages=[message],
            inferenceConfig={"maxTokens": 256, "temperature": 0},
        )
    except (BotoCoreError, ClientError) as exc:
        raise BedrockExtractionError(f"Bedrock API error: {exc}") from exc

    raw_text: str = (
        response.get("output", {})
        .get("message", {})
        .get("content", [{}])[0]
        .get("text", "")
        .strip()
    )

    return _parse_extraction_response(raw_text)


def _parse_extraction_response(raw_text: str) -> ExtractedIdentity:
    """Parse Nova's JSON response into an ExtractedIdentity."""
    # Strip markdown code fences if the model wraps the JSON
    text = raw_text
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(
            line for line in lines if not line.startswith("```")
        ).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BedrockExtractionError(
            f"Nova returned non-JSON output: {raw_text!r}"
        ) from exc

    return ExtractedIdentity(
        full_name=data.get("full_name") or None,
        id_number=data.get("id_number") or None,
        raw_response=raw_text,
    )


# ---------------------------------------------------------------------------
# Risk scoring
# ---------------------------------------------------------------------------

@dataclass
class RiskScore:
    trust_score: int        # 0-100 (100 = lowest risk)
    risk_tier: str          # LOW | MEDIUM | HIGH | BLOCKED
    risk_narrative: str     # one-sentence explanation
    raw_response: str = ""


_RISK_SYSTEM_PROMPT = """\
You are a financial risk assessment engine for a lending platform.
Analyse the borrower profile and loan request provided by the user.

Scoring rules:
- trust_score: integer 0–100  (100 = lowest risk, 0 = highest risk)
- risk_tier must be exactly one of: LOW, MEDIUM, HIGH, BLOCKED
    LOW     → trust_score 70–100  (standard approval path)
    MEDIUM  → trust_score 40–69   (proceed with monitoring)
    HIGH    → trust_score 15–39   (flag for analyst review)
    BLOCKED → trust_score 0–14, OR any fraud / sanctions indicator present
- risk_narrative: one concise sentence naming the single most important risk factor.

Respond with ONLY a valid JSON object — no markdown, no explanation, no extra keys:
{"trust_score": <int>, "risk_tier": "<LOW|MEDIUM|HIGH|BLOCKED>", "risk_narrative": "<string>"}\
"""


def score_borrower_risk(
    *,
    full_name: str,
    kyc_status: str,
    account_age_days: int,
    previous_loan_count: int,
    loan_amount: float,
    loan_purpose: str,
    duration_months: int,
    device_info: dict,
) -> RiskScore:
    """
    Ask Nova to score a loan application.

    When MOCK_AI=true the AWS call is skipped and a deterministic score is
    returned so the demo flows end-to-end without AWS credentials.

    Raises:
        BedrockExtractionError: on API failure or unparseable response.
    """
    if _mock_mode():
        return RiskScore(
            trust_score=82,
            risk_tier="LOW",
            risk_narrative=(
                f"KYC-verified borrower requesting ${loan_amount:,.0f} "
                f"over {duration_months} months for {loan_purpose.lower()} — "
                "moderate loan-to-income ratio with no adverse indicators."
            ),
            raw_response="[mock]",
        )

    user_message = (
        f"Borrower Profile:\n"
        f"- Name: {full_name}\n"
        f"- KYC status: {kyc_status}\n"
        f"- Account age: {account_age_days} days\n"
        f"- Previous loans on platform: {previous_loan_count}\n"
        f"\n"
        f"Loan Request:\n"
        f"- Amount: ${loan_amount:,.2f}\n"
        f"- Purpose: {loan_purpose}\n"
        f"- Duration: {duration_months} months\n"
        f"\n"
        f"Device / Session Info:\n"
        + "\n".join(f"- {k}: {v}" for k, v in device_info.items())
    )

    message = {"role": "user", "content": [{"text": user_message}]}
    system = [{"text": _RISK_SYSTEM_PROMPT}]

    try:
        response = get_bedrock_client().converse(
            modelId=get_model_id(),
            system=system,
            messages=[message],
            inferenceConfig={"maxTokens": 256, "temperature": 0},
        )
    except (BotoCoreError, ClientError) as exc:
        raise BedrockExtractionError(f"Bedrock API error: {exc}") from exc

    raw_text: str = (
        response.get("output", {})
        .get("message", {})
        .get("content", [{}])[0]
        .get("text", "")
        .strip()
    )

    return _parse_risk_response(raw_text)


def _parse_risk_response(raw_text: str) -> RiskScore:
    text = raw_text
    if text.startswith("```"):
        text = "\n".join(
            line for line in text.splitlines() if not line.startswith("```")
        ).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BedrockExtractionError(
            f"Nova returned non-JSON risk response: {raw_text!r}"
        ) from exc

    trust_score = int(data.get("trust_score", -1))
    risk_tier = str(data.get("risk_tier", "")).upper()
    risk_narrative = str(data.get("risk_narrative", "")).strip()

    valid_tiers = {"LOW", "MEDIUM", "HIGH", "BLOCKED"}
    if trust_score < 0 or trust_score > 100 or risk_tier not in valid_tiers or not risk_narrative:
        raise BedrockExtractionError(
            f"Risk response failed validation: trust_score={trust_score!r} "
            f"risk_tier={risk_tier!r} narrative={risk_narrative!r}"
        )

    return RiskScore(
        trust_score=trust_score,
        risk_tier=risk_tier,
        risk_narrative=risk_narrative,
        raw_response=raw_text,
    )


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class BedrockExtractionError(Exception):
    """Raised when Bedrock extraction fails (API error or bad response)."""

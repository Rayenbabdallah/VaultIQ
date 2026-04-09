"""
AWS Bedrock client for VaultIQ.

Wraps the boto3 Bedrock Runtime converse() API for Amazon Nova models.
Provides a typed document-extraction helper used by the KYC module.
"""

import json
import os
from dataclasses import dataclass
from functools import lru_cache

import boto3
from botocore.exceptions import BotoCoreError, ClientError


# ---------------------------------------------------------------------------
# Client singleton
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_bedrock_client():
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


def extract_identity_from_image(
    image_bytes: bytes,
    mime_type: str,  # "image/jpeg" or "image/png"
) -> ExtractedIdentity:
    """
    Send the document image to Nova and parse the returned JSON.

    Raises:
        BedrockExtractionError: if the API call fails or returns unparseable output.
    """
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
# Exceptions
# ---------------------------------------------------------------------------

class BedrockExtractionError(Exception):
    """Raised when Bedrock extraction fails (API error or bad response)."""

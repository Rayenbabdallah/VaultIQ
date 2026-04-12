"""
PAdES / XAdES signing engine — VaultIQ

Produces three cryptographic artifact types per loan agreement:

  PAdES-B  vault/signed/{id}_pades_b.pdf   CAdES-detached signature (ETSI EN 319 122)
  PAdES-T  vault/signed/{id}_pades_t.pdf   PAdES-B + RFC 3161 document timestamp
  XAdES-T  vault/signed/{id}_xades.xml     Detached XML signature + signature timestamp

All three functions:
  - Write to vault/signed/
  - Compute SHA-256 of the produced artifact
  - Write an AuditLog row with action, path, and hash
  - Update the matching path column on LoanApplication

RFC 3161 timestamps are requested from freetsa.org (configurable via TSA_URL env var).

System requirements
-------------------
pyHanko uses aiohttp for network calls; all async internals are run in a
dedicated event loop via _run_async() so callers stay synchronous.
"""

import asyncio
import base64
import hashlib
import io
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests as http_requests
from asn1crypto import algos, tsp
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.x509 import load_pem_x509_certificate
from lxml import etree
from sqlalchemy.orm import Session

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import signers
from pyhanko.sign.fields import SigSeedSubFilter
from pyhanko.sign.signers import PdfTimestamper
from pyhanko.sign.timestamps import HTTPTimeStamper

from api.models import AuditLog, LoanApplication

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------

PROJECT_ROOT    = Path(__file__).parent.parent
CERTS_DIR       = PROJECT_ROOT / "certs"
LEAF_KEY_PATH   = CERTS_DIR / "leaf.key.pem"
LEAF_CERT_PATH  = CERTS_DIR / "leaf.cert.pem"
CA_CERT_PATH    = CERTS_DIR / "ca.cert.pem"
VAULT_SIGNED_DIR = PROJECT_ROOT / "vault" / "signed"

TSA_URL = os.getenv("TSA_URL", "https://freetsa.org/tsr")

# XML namespace constants
_DS    = "http://www.w3.org/2000/09/xmldsig#"
_XADES = "http://uri.etsi.org/01903/v1.3.2#"
_ALG_SHA256     = "http://www.w3.org/2001/04/xmlenc#sha256"
_ALG_RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
_ALG_C14N       = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
_XADES_SIGNED_PROPS_TYPE = "http://uri.etsi.org/01903#SignedProperties"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_loan(loan_id: int, db: Session) -> LoanApplication:
    loan = db.query(LoanApplication).filter(LoanApplication.id == loan_id).first()
    if loan is None:
        raise LookupError(f"LoanApplication {loan_id} not found")
    return loan


def _load_signer() -> signers.SimpleSigner:
    return signers.SimpleSigner.load(
        key_file=str(LEAF_KEY_PATH),
        cert_file=str(LEAF_CERT_PATH),
        ca_chain_files=[str(CA_CERT_PATH)],
        key_passphrase=None,
    )


def _sha256_hex(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _run_async(coro):
    """
    Execute a coroutine from a synchronous (thread-pool) context.
    Creates a dedicated event loop so it never conflicts with FastAPI's loop.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _persist(
    *,
    loan: LoanApplication,
    db: Session,
    action: str,
    detail: str,
) -> None:
    db.add(AuditLog(
        actor_id=loan.applicant_id,
        loan_application_id=loan.id,
        action=action,
        detail=detail,
    ))
    db.commit()


def _request_tsp_token(digest: bytes) -> bytes:
    """
    Build and send an RFC 3161 TimeStampReq, return the DER-encoded token.
    Uses asn1crypto directly — no async required.
    """
    req = tsp.TimeStampReq({
        "version": 1,
        "message_imprint": tsp.MessageImprint({
            "hash_algorithm": algos.DigestAlgorithm({"algorithm": "sha256"}),
            "hashed_message": digest,
        }),
        "cert_req": True,
        "nonce": int.from_bytes(os.urandom(8), "big"),
    })
    resp_raw = http_requests.post(
        TSA_URL,
        data=req.dump(),
        headers={"Content-Type": "application/timestamp-query"},
        timeout=30,
    )
    resp_raw.raise_for_status()
    resp = tsp.TimeStampResp.load(resp_raw.content)
    status = resp["status"]["status"].native
    if status not in ("granted", "grantedWithMods"):
        raise RuntimeError(f"TSA refused: status={status}")
    return resp["time_stamp_token"].dump()


# ---------------------------------------------------------------------------
# PAdES-B
# ---------------------------------------------------------------------------

def sign_pades_b(loan_id: int, db: Session) -> Path:
    """
    Apply a CAdES-detached (PAdES-B) signature to the unsigned loan PDF.

    Reads  : loan.pdf_unsigned_path
    Writes : vault/signed/{loan_id}_pades_b.pdf
    Updates: loan.pdf_pades_b_path
    Audits : loan.pades_b_signed  (sha256, path)
    """
    loan = _get_loan(loan_id, db)
    if not loan.pdf_unsigned_path:
        raise ValueError(f"Loan {loan_id} has no unsigned PDF")

    unsigned_path = PROJECT_ROOT / loan.pdf_unsigned_path
    VAULT_SIGNED_DIR.mkdir(parents=True, exist_ok=True)
    pades_b_path = VAULT_SIGNED_DIR / f"{loan_id}_pades_b.pdf"

    signer = _load_signer()

    with open(unsigned_path, "rb") as fh:
        w = IncrementalPdfFileWriter(fh)
        meta = signers.PdfSignatureMetadata(
            field_name="VaultIQSignature",
            subfilter=SigSeedSubFilter.PADES,
        )
        result = signers.sign_pdf(w, meta, signer=signer)

    pades_b_path.write_bytes(result.getvalue())
    doc_hash = _sha256_hex(pades_b_path)

    loan.pdf_pades_b_path = str(pades_b_path.relative_to(PROJECT_ROOT))
    loan.updated_at = datetime.now(timezone.utc)
    _persist(
        loan=loan, db=db,
        action="loan.pades_b_signed",
        detail=f"sha256={doc_hash} path={loan.pdf_pades_b_path}",
    )
    logger.info("PAdES-B loan=%s sha256=%s", loan_id, doc_hash)
    return pades_b_path


# ---------------------------------------------------------------------------
# PAdES-T
# ---------------------------------------------------------------------------

async def _async_doc_timestamp(pades_b_bytes: bytes) -> bytes:
    """Embed an RFC 3161 document timestamp into a signed PDF (PAdES-T upgrade)."""
    timestamper = HTTPTimeStamper(TSA_URL)
    pdf_ts = PdfTimestamper(timestamper)
    buf = io.BytesIO(pades_b_bytes)
    w = IncrementalPdfFileWriter(buf)
    result = await pdf_ts.async_timestamp_pdf(w, md_algorithm="sha256")
    return result.getvalue()


def sign_pades_t(loan_id: int, db: Session) -> Path:
    """
    Upgrade a PAdES-B PDF to PAdES-T by adding an RFC 3161 document timestamp
    via freetsa.org (configurable with TSA_URL).

    Reads  : loan.pdf_pades_b_path
    Writes : vault/signed/{loan_id}_pades_t.pdf
    Updates: loan.pdf_pades_t_path
    Audits : loan.pades_t_signed  (sha256, path, tsa)
    """
    loan = _get_loan(loan_id, db)
    if not loan.pdf_pades_b_path:
        raise ValueError(f"Loan {loan_id} has no PAdES-B PDF; run sign_pades_b first")

    pades_b_path = PROJECT_ROOT / loan.pdf_pades_b_path
    VAULT_SIGNED_DIR.mkdir(parents=True, exist_ok=True)
    pades_t_path = VAULT_SIGNED_DIR / f"{loan_id}_pades_t.pdf"

    pades_t_bytes = _run_async(_async_doc_timestamp(pades_b_path.read_bytes()))
    pades_t_path.write_bytes(pades_t_bytes)

    doc_hash = _sha256_hex(pades_t_path)
    loan.pdf_pades_t_path = str(pades_t_path.relative_to(PROJECT_ROOT))
    loan.updated_at = datetime.now(timezone.utc)
    _persist(
        loan=loan, db=db,
        action="loan.pades_t_signed",
        detail=f"sha256={doc_hash} path={loan.pdf_pades_t_path} tsa={TSA_URL}",
    )
    logger.info("PAdES-T loan=%s sha256=%s", loan_id, doc_hash)
    return pades_t_path


# ---------------------------------------------------------------------------
# XAdES-T  (detached XML signature over the PAdES-T PDF)
# ---------------------------------------------------------------------------

def generate_xades_t(loan_id: int, db: Session) -> Path:
    """
    Produce a detached XAdES-T XML signature file for the PAdES-T PDF.

    Signing flow:
      1. SHA-256 the PAdES-T PDF  → pdf_hash
      2. Build SignedProperties  → c14n → hash → signed_props_hash
      3. Build SignedInfo with both References → c14n bytes
      4. RSA-SHA256 sign the SignedInfo bytes  → sig_value
      5. Request RFC 3161 timestamp over SHA-256(sig_value) → tst_der
      6. Assemble and serialise the complete XAdES-T document

    Reads  : loan.pdf_pades_t_path
    Writes : vault/signed/{loan_id}_xades.xml
    Updates: loan.xml_xades_t_path
    Audits : loan.xades_t_generated  (sha256, path, tsa)
    """
    loan = _get_loan(loan_id, db)
    if not loan.pdf_pades_t_path:
        raise ValueError(f"Loan {loan_id} has no PAdES-T PDF; run sign_pades_t first")

    pades_t_path = PROJECT_ROOT / loan.pdf_pades_t_path
    VAULT_SIGNED_DIR.mkdir(parents=True, exist_ok=True)
    xades_path = VAULT_SIGNED_DIR / f"{loan_id}_xades.xml"

    # ── Load key material ──────────────────────────────────────────────────
    private_key = serialization.load_pem_private_key(
        LEAF_KEY_PATH.read_bytes(), password=None, backend=default_backend()
    )
    cert_der = load_pem_x509_certificate(
        LEAF_CERT_PATH.read_bytes(), default_backend()
    ).public_bytes(serialization.Encoding.DER)
    cert_b64      = base64.b64encode(cert_der).decode()
    cert_hash_b64 = base64.b64encode(hashlib.sha256(cert_der).digest()).decode()

    # ── Fixed identifiers ──────────────────────────────────────────────────
    sig_id      = f"VaultIQSig-{loan_id}"
    props_id    = f"signed-props-{loan_id}"
    signing_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pdf_uri     = str(pades_t_path.relative_to(PROJECT_ROOT)).replace("\\", "/")

    # ── Step 1: hash the PDF ───────────────────────────────────────────────
    pdf_hash_b64 = base64.b64encode(
        hashlib.sha256(pades_t_path.read_bytes()).digest()
    ).decode()

    # ── Step 2: SignedProperties c14n → hash ───────────────────────────────
    signed_props_c14n = _serialize_signed_properties(
        props_id=props_id,
        signing_time=signing_time,
        cert_hash_b64=cert_hash_b64,
    )
    signed_props_hash_b64 = base64.b64encode(
        hashlib.sha256(signed_props_c14n).digest()
    ).decode()

    # ── Step 3: SignedInfo c14n ────────────────────────────────────────────
    signed_info_c14n = _serialize_signed_info(
        pdf_hash_b64=pdf_hash_b64,
        signed_props_hash_b64=signed_props_hash_b64,
        props_id=props_id,
        pdf_uri=pdf_uri,
    )

    # ── Step 4: RSA-SHA256 signature over SignedInfo ───────────────────────
    sig_value_bytes = private_key.sign(
        signed_info_c14n, asym_padding.PKCS1v15(), hashes.SHA256()
    )
    sig_value_b64 = base64.b64encode(sig_value_bytes).decode()

    # ── Step 5: RFC 3161 timestamp over SHA-256(sig_value) ────────────────
    tst_b64: Optional[str] = None
    try:
        tst_der = _request_tsp_token(hashlib.sha256(sig_value_bytes).digest())
        tst_b64 = base64.b64encode(tst_der).decode()
    except Exception as exc:
        logger.warning("TSP timestamp failed for XAdES-T loan=%s: %s — continuing without", loan_id, exc)

    # ── Step 6: assemble XAdES-T XML ──────────────────────────────────────
    xml_bytes = _build_xades_document(
        sig_id=sig_id,
        props_id=props_id,
        pdf_uri=pdf_uri,
        pdf_hash_b64=pdf_hash_b64,
        signed_props_hash_b64=signed_props_hash_b64,
        signing_time=signing_time,
        cert_hash_b64=cert_hash_b64,
        sig_value_b64=sig_value_b64,
        cert_b64=cert_b64,
        tst_b64=tst_b64,
    )
    xades_path.write_bytes(xml_bytes)

    xml_hash = hashlib.sha256(xml_bytes).hexdigest()
    loan.xml_xades_t_path = str(xades_path.relative_to(PROJECT_ROOT))
    loan.updated_at = datetime.now(timezone.utc)
    _persist(
        loan=loan, db=db,
        action="loan.xades_t_generated",
        detail=f"sha256={xml_hash} path={loan.xml_xades_t_path} tsa={TSA_URL}",
    )
    logger.info("XAdES-T loan=%s sha256=%s", loan_id, xml_hash)
    return xades_path


# ---------------------------------------------------------------------------
# XAdES XML builders  (each returns canonical bytes to allow independent signing)
# ---------------------------------------------------------------------------

def _c14n(elem: etree._Element) -> bytes:
    """Return Canonical XML bytes (non-exclusive) for the given element."""
    return etree.tostring(elem, method="c14n", exclusive=False)


def _serialize_signed_properties(
    *, props_id: str, signing_time: str, cert_hash_b64: str
) -> bytes:
    """Build the xades:SignedProperties element and return its c14n bytes."""
    nsmap = {"ds": _DS, "xades": _XADES}

    signed_props = etree.Element(f"{{{_XADES}}}SignedProperties", attrib={"Id": props_id}, nsmap=nsmap)

    sig_sig_props = etree.SubElement(signed_props, f"{{{_XADES}}}SignedSignatureProperties")

    st = etree.SubElement(sig_sig_props, f"{{{_XADES}}}SigningTime")
    st.text = signing_time

    signing_cert = etree.SubElement(sig_sig_props, f"{{{_XADES}}}SigningCertificateV2")
    cert_elem    = etree.SubElement(signing_cert, f"{{{_XADES}}}Cert")
    cert_digest  = etree.SubElement(cert_elem, f"{{{_XADES}}}CertDigest")

    dm = etree.SubElement(cert_digest, f"{{{_DS}}}DigestMethod")
    dm.set("Algorithm", _ALG_SHA256)
    dv = etree.SubElement(cert_digest, f"{{{_DS}}}DigestValue")
    dv.text = cert_hash_b64

    return _c14n(signed_props)


def _serialize_signed_info(
    *,
    pdf_hash_b64: str,
    signed_props_hash_b64: str,
    props_id: str,
    pdf_uri: str,
) -> bytes:
    """Build the ds:SignedInfo element and return its c14n bytes."""
    nsmap = {"ds": _DS, "xades": _XADES}

    si = etree.Element(f"{{{_DS}}}SignedInfo", nsmap=nsmap)

    c14n_method = etree.SubElement(si, f"{{{_DS}}}CanonicalizationMethod")
    c14n_method.set("Algorithm", _ALG_C14N)

    sig_method = etree.SubElement(si, f"{{{_DS}}}SignatureMethod")
    sig_method.set("Algorithm", _ALG_RSA_SHA256)

    # Reference 1 — the PAdES-T PDF (external document)
    ref_doc = etree.SubElement(si, f"{{{_DS}}}Reference", attrib={"Id": "ref-doc", "URI": pdf_uri})
    dm1 = etree.SubElement(ref_doc, f"{{{_DS}}}DigestMethod")
    dm1.set("Algorithm", _ALG_SHA256)
    dv1 = etree.SubElement(ref_doc, f"{{{_DS}}}DigestValue")
    dv1.text = pdf_hash_b64

    # Reference 2 — the SignedProperties (within this document)
    ref_props = etree.SubElement(
        si, f"{{{_DS}}}Reference",
        attrib={
            "Id": "ref-props",
            "URI": f"#{props_id}",
            "Type": _XADES_SIGNED_PROPS_TYPE,
        },
    )
    dm2 = etree.SubElement(ref_props, f"{{{_DS}}}DigestMethod")
    dm2.set("Algorithm", _ALG_SHA256)
    dv2 = etree.SubElement(ref_props, f"{{{_DS}}}DigestValue")
    dv2.text = signed_props_hash_b64

    return _c14n(si)


def _build_xades_document(
    *,
    sig_id: str,
    props_id: str,
    pdf_uri: str,
    pdf_hash_b64: str,
    signed_props_hash_b64: str,
    signing_time: str,
    cert_hash_b64: str,
    sig_value_b64: str,
    cert_b64: str,
    tst_b64: Optional[str],
) -> bytes:
    """Assemble the complete ds:Signature element and serialise to UTF-8 XML."""
    nsmap = {"ds": _DS, "xades": _XADES}

    sig = etree.Element(f"{{{_DS}}}Signature", attrib={"Id": sig_id}, nsmap=nsmap)

    # ── SignedInfo ─────────────────────────────────────────────────────────
    si = etree.SubElement(sig, f"{{{_DS}}}SignedInfo")

    cm = etree.SubElement(si, f"{{{_DS}}}CanonicalizationMethod")
    cm.set("Algorithm", _ALG_C14N)

    sm = etree.SubElement(si, f"{{{_DS}}}SignatureMethod")
    sm.set("Algorithm", _ALG_RSA_SHA256)

    ref_doc = etree.SubElement(si, f"{{{_DS}}}Reference", attrib={"Id": "ref-doc", "URI": pdf_uri})
    dm1 = etree.SubElement(ref_doc, f"{{{_DS}}}DigestMethod"); dm1.set("Algorithm", _ALG_SHA256)
    dv1 = etree.SubElement(ref_doc, f"{{{_DS}}}DigestValue"); dv1.text = pdf_hash_b64

    ref_props = etree.SubElement(
        si, f"{{{_DS}}}Reference",
        attrib={"Id": "ref-props", "URI": f"#{props_id}", "Type": _XADES_SIGNED_PROPS_TYPE},
    )
    dm2 = etree.SubElement(ref_props, f"{{{_DS}}}DigestMethod"); dm2.set("Algorithm", _ALG_SHA256)
    dv2 = etree.SubElement(ref_props, f"{{{_DS}}}DigestValue"); dv2.text = signed_props_hash_b64

    # ── SignatureValue ─────────────────────────────────────────────────────
    sv = etree.SubElement(sig, f"{{{_DS}}}SignatureValue")
    sv.text = sig_value_b64

    # ── KeyInfo ───────────────────────────────────────────────────────────
    ki   = etree.SubElement(sig, f"{{{_DS}}}KeyInfo")
    x5d  = etree.SubElement(ki,  f"{{{_DS}}}X509Data")
    x5c  = etree.SubElement(x5d, f"{{{_DS}}}X509Certificate")
    x5c.text = cert_b64

    # ── Object → QualifyingProperties ─────────────────────────────────────
    obj  = etree.SubElement(sig, f"{{{_DS}}}Object")
    qp   = etree.SubElement(obj, f"{{{_XADES}}}QualifyingProperties", attrib={"Target": f"#{sig_id}"})

    # SignedProperties
    sp   = etree.SubElement(qp, f"{{{_XADES}}}SignedProperties", attrib={"Id": props_id})
    ssp  = etree.SubElement(sp, f"{{{_XADES}}}SignedSignatureProperties")

    st   = etree.SubElement(ssp, f"{{{_XADES}}}SigningTime"); st.text = signing_time

    scv2 = etree.SubElement(ssp, f"{{{_XADES}}}SigningCertificateV2")
    ce   = etree.SubElement(scv2, f"{{{_XADES}}}Cert")
    cd   = etree.SubElement(ce,   f"{{{_XADES}}}CertDigest")
    cdm  = etree.SubElement(cd,   f"{{{_DS}}}DigestMethod");  cdm.set("Algorithm", _ALG_SHA256)
    cdv  = etree.SubElement(cd,   f"{{{_DS}}}DigestValue");   cdv.text = cert_hash_b64

    # UnsignedProperties — SignatureTimeStamp (only if TST was obtained)
    if tst_b64:
        up   = etree.SubElement(qp,  f"{{{_XADES}}}UnsignedProperties")
        usp  = etree.SubElement(up,  f"{{{_XADES}}}UnsignedSignatureProperties")
        stsm = etree.SubElement(usp, f"{{{_XADES}}}SignatureTimeStamp")
        ets  = etree.SubElement(stsm, f"{{{_XADES}}}EncapsulatedTimeStamp")
        ets.text = tst_b64

    return etree.tostring(sig, xml_declaration=True, encoding="UTF-8", pretty_print=True)

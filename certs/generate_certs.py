"""
Generate a self-signed CA and a leaf certificate/key pair for VaultIQ.

Output files (written to the same directory as this script):
  ca.cert.pem      — CA certificate (self-signed)
  ca.key.pem       — CA private key
  leaf.cert.pem    — Leaf certificate signed by the CA
  leaf.key.pem     — Leaf private key  (used for JWT RS256 signing)

Usage:
  python certs/generate_certs.py
"""

import datetime
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

CERTS_DIR = Path(__file__).parent
KEY_SIZE = 2048
CA_COMMON_NAME = "VaultIQ Internal CA"
LEAF_COMMON_NAME = "vaultiq-api"
VALIDITY_DAYS = 3650  # 10 years for dev certs


def _new_rsa_key() -> rsa.RSAPrivateKey:
    from cryptography.hazmat.backends import default_backend
    return rsa.generate_private_key(
        public_exponent=65537,
        key_size=KEY_SIZE,
        backend=default_backend(),
    )


def _save_private_key(key: rsa.RSAPrivateKey, path: Path) -> None:
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    print(f"  Written: {path}")


def _save_cert(cert: x509.Certificate, path: Path) -> None:
    path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"  Written: {path}")


def generate_ca() -> tuple[rsa.RSAPrivateKey, x509.Certificate]:
    key = _new_rsa_key()
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, CA_COMMON_NAME),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "VaultIQ"),
    ])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=VALIDITY_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .sign(key, hashes.SHA256())
    )
    return key, cert


def generate_leaf(
    ca_key: rsa.RSAPrivateKey,
    ca_cert: x509.Certificate,
) -> tuple[rsa.RSAPrivateKey, x509.Certificate]:
    key = _new_rsa_key()
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, LEAF_COMMON_NAME),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "VaultIQ"),
    ])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=VALIDITY_DAYS))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,   # non-repudiation — required by pyHanko
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.EMAIL_PROTECTION]),
            critical=False,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.DNSName(LEAF_COMMON_NAME),
            ]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    return key, cert


def main():
    print("Generating VaultIQ development certificates...")

    ca_key, ca_cert = generate_ca()
    _save_private_key(ca_key, CERTS_DIR / "ca.key.pem")
    _save_cert(ca_cert, CERTS_DIR / "ca.cert.pem")

    leaf_key, leaf_cert = generate_leaf(ca_key, ca_cert)
    _save_private_key(leaf_key, CERTS_DIR / "leaf.key.pem")
    _save_cert(leaf_cert, CERTS_DIR / "leaf.cert.pem")

    print("\nDone. Keep ca.key.pem and leaf.key.pem secret — never commit them.")


if __name__ == "__main__":
    main()

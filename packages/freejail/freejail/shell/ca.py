"""CA certificate generation for mitmproxy TLS interception."""

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from cryptography.x509.oid import NameOID

from freejail.constants import (
    CA_CERT_FILENAME,
    CA_COMMON_NAME,
    CA_DIR_NAME,
    CA_KEY_FILENAME,
    CA_VALIDITY_YEARS,
    DATA_DIR_ENV,
    DATA_DIR_NAME,
    MITMPROXY_CA_CERT_FILENAME,
    MITMPROXY_CA_FILENAME,
    MITMPROXY_DHPARAM_FILENAME,
)


def ca_dir(home_dir: str) -> Path:
    """Return the CA directory path."""
    override = os.environ.get(DATA_DIR_ENV)
    base = Path(override) if override else Path(home_dir) / DATA_DIR_NAME
    return base / CA_DIR_NAME


def ca_cert_path(home_dir: str) -> str:
    """Return the CA certificate file path."""
    return str(ca_dir(home_dir) / CA_CERT_FILENAME)


def ensure_ca(home_dir: str) -> str:
    """Ensure CA cert+key exist. Generate if missing. Return cert path."""
    directory = ca_dir(home_dir)
    cert_path = directory / CA_CERT_FILENAME
    key_path = directory / CA_KEY_FILENAME
    mitmproxy_path = directory / MITMPROXY_CA_FILENAME
    mitmproxy_cert_path = directory / MITMPROXY_CA_CERT_FILENAME
    dhparam_path = directory / MITMPROXY_DHPARAM_FILENAME

    if (
        cert_path.exists()
        and key_path.exists()
        and mitmproxy_path.exists()
        and mitmproxy_cert_path.exists()
        and dhparam_path.exists()
    ):
        return str(cert_path)

    directory.mkdir(parents=True, exist_ok=True)

    # EC key (prime256v1) — matches original freejail
    key = generate_private_key(SECP256R1())

    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )

    # Self-signed CA certificate with proper extensions for TLS interception
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, CA_COMMON_NAME),
        ]
    )
    now = datetime.now(tz=UTC)
    ski = x509.SubjectKeyIdentifier.from_public_key(key.public_key())
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=CA_VALIDITY_YEARS * 365))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                key_cert_sign=True,
                crl_sign=True,
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(ski, critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(ski),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM)

    # Write files
    key_path.write_bytes(key_pem)
    key_path.chmod(0o600)
    cert_path.write_bytes(cert_pem)

    # mitmproxy expects key+cert combined (key first, matching original freejail)
    mitmproxy_path.write_bytes(key_pem + cert_pem)
    mitmproxy_path.chmod(0o600)

    # mitmproxy-ca-cert.pem — cert-only copy for mitmproxy
    mitmproxy_cert_path.write_bytes(cert_pem)

    # RFC 3526 Group 14 (2048-bit MODP) — same value mitmproxy embeds as
    # DEFAULT_DHPARAM. Pre-baked so mitmproxy doesn't need to write it at runtime.
    dhparam_path.write_text("""\
-----BEGIN DH PARAMETERS-----
MIIBCAKCAQEA///////////JD9qiIWjCNMTGYouA3BzRKQJOCIpnzHQCC76mOxOb
IlFKCHmONATd75UZs806QxswKwpt8l8UN0/hNW1tUcJF5IW1dmJefsb0TELppjft
awv/XLb0Brft7jhr+1qJn6WunyQRfEsf5kkoZlHs5Fs9wgB8uKFjvwWY2kg2HFXT
mmkWP6j9JM9fg2VdI9yjrZYcYvNWIIVSu57VKQdwlpZtZww1Tkq8mATxdGwIyhgh
fDKQXkYuNs474553LBgOhgObJ4Oi7Aeij7XFXfBvTFLJ3ivL9pVYFxg5lUl86pVq
5RXSJhiY+gUQFXKOWoqsqmj//////////wIBAg==
-----END DH PARAMETERS-----
""")

    return str(cert_path)

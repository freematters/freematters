"""Infrastructure constants for freejail."""

# --- Default image ---
DEFAULT_IMAGE = "freematters/freejail:local_latest"

# --- Default command ---
DEFAULT_COMMAND = ["sleep", "infinity"]

# --- Subnet ---
SUBNET_PREFIX = "21.18"
SUBNET_MIN = 1
SUBNET_MAX = 255
EXTERNAL_NETWORK_NAME = "fj-external"
EXTERNAL_NETWORK_SUBNET = "21.18.0.0/24"

# --- Proxy ---
PROXY_IMAGE = "docker.io/mitmproxy/mitmproxy:latest"
PROXY_PORT = 8080

# --- Data directory ---
DATA_DIR_NAME = ".freejail"
DATA_DIR_ENV = "FJ_DATA_DIR"

# --- CA ---
CA_DIR_NAME = "ca"
CA_CERT_FILENAME = "fj-ca.pem"
CA_KEY_FILENAME = "fj-ca-key.pem"
MITMPROXY_CA_FILENAME = "mitmproxy-ca.pem"
MITMPROXY_CA_CERT_FILENAME = "mitmproxy-ca-cert.pem"
MITMPROXY_DHPARAM_FILENAME = "mitmproxy-dhparam.pem"
CA_COMMON_NAME = "freejail-headless-ca"
CA_VALIDITY_YEARS = 10
CA_MOUNT_TARGET = "/usr/local/share/ca-certificates/fj-ca.crt"

# --- CA env vars injected into app container ---
CA_ENV_VARS = {
    "SSL_CERT_FILE": CA_MOUNT_TARGET,
    "REQUESTS_CA_BUNDLE": CA_MOUNT_TARGET,
    "NODE_EXTRA_CA_CERTS": CA_MOUNT_TARGET,
    "GIT_SSL_CAINFO": CA_MOUNT_TARGET,
    "CURL_CA_BUNDLE": CA_MOUNT_TARGET,
    "PIP_CERT": CA_MOUNT_TARGET,
}

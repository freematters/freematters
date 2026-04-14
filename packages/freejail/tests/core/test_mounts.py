from freejail.core.mounts import resolve_mounts
from freejail.models import Mount

SAMPLE_MOUNTS = [
    Mount(source="~/.claude", target="~/.claude", options="rw"),
    Mount(source="~/.codex", target="~/.codex", options="rw"),
    Mount(source="~/.claude.json", target="~/.claude.json", options="rw"),
]


def test_default_mounts_expand_home():
    result = resolve_mounts(
        cwd="/home/testuser/project",
        home_dir="/home/testuser",
        container_home="/home/testuser",
        ca_cert_path="/data/ca/fj-ca.pem",
        default_mounts=SAMPLE_MOUNTS,
        config_mounts=[],
        cli_mounts=[],
    )
    sources = [m.source for m in result]
    targets = [m.target for m in result]
    assert "/home/testuser/.claude" in sources
    assert "/home/testuser/.claude" in targets
    assert "/home/testuser/project" in sources
    assert "/data/ca/fj-ca.pem" in sources


def test_cwd_mount_preserves_path():
    result = resolve_mounts(
        cwd="/opt/work/myrepo",
        home_dir="/home/user",
        container_home="/home/user",
        ca_cert_path="/data/ca/fj-ca.pem",
        default_mounts=SAMPLE_MOUNTS,
        config_mounts=[],
        cli_mounts=[],
    )
    cwd_mount = next(m for m in result if m.source == "/opt/work/myrepo")
    assert cwd_mount.target == "/opt/work/myrepo"
    assert cwd_mount.options == "rw"


def test_config_mounts_appended():
    extra = [Mount(source="/data/models", target="/models", options="ro")]
    result = resolve_mounts(
        cwd="/home/user/project",
        home_dir="/home/user",
        container_home="/home/user",
        ca_cert_path="/data/ca/fj-ca.pem",
        default_mounts=SAMPLE_MOUNTS,
        config_mounts=extra,
        cli_mounts=[],
    )
    sources = [m.source for m in result]
    assert "/data/models" in sources


def test_cli_mounts_appended():
    cli = [Mount(source="/tmp/data", target="/tmp/data", options="rw")]
    result = resolve_mounts(
        cwd="/home/user/project",
        home_dir="/home/user",
        container_home="/home/user",
        ca_cert_path="/data/ca/fj-ca.pem",
        default_mounts=SAMPLE_MOUNTS,
        config_mounts=[],
        cli_mounts=cli,
    )
    sources = [m.source for m in result]
    assert "/tmp/data" in sources


def test_ca_cert_mount_is_readonly():
    result = resolve_mounts(
        cwd="/home/user/project",
        home_dir="/home/user",
        container_home="/home/user",
        ca_cert_path="/data/ca/fj-ca.pem",
        default_mounts=SAMPLE_MOUNTS,
        config_mounts=[],
        cli_mounts=[],
    )
    ca_mount = next(m for m in result if m.target == "/usr/local/share/ca-certificates/fj-ca.crt")
    assert ca_mount.options == "ro"


def test_different_container_home():
    """Source uses host home, target uses container home."""
    result = resolve_mounts(
        cwd="/opt/work",
        home_dir="/root",
        container_home="/home/ubuntu",
        ca_cert_path="/data/ca/fj-ca.pem",
        default_mounts=SAMPLE_MOUNTS,
        config_mounts=[],
        cli_mounts=[],
    )
    sources = [m.source for m in result]
    targets = [m.target for m in result]
    assert "/root/.claude" in sources
    assert "/home/ubuntu/.claude" in targets


def test_root_user_no_remap():
    """When host user is root, target stays /root."""
    result = resolve_mounts(
        cwd="/opt/work",
        home_dir="/root",
        container_home="/root",
        ca_cert_path="/data/ca/fj-ca.pem",
        default_mounts=SAMPLE_MOUNTS,
        config_mounts=[],
        cli_mounts=[],
    )
    targets = [m.target for m in result]
    assert "/root/.claude" in targets


def test_empty_default_mounts():
    """No default mounts — only cwd and CA."""
    result = resolve_mounts(
        cwd="/opt/work",
        home_dir="/root",
        container_home="/root",
        ca_cert_path="/data/ca/fj-ca.pem",
        default_mounts=[],
        config_mounts=[],
        cli_mounts=[],
    )
    assert len(result) == 2  # cwd + CA

"""Podman subprocess wrappers."""

import os
import subprocess

from freejail.constants import (
    CA_ENV_VARS,
    DEFAULT_IMAGE,
    EXTERNAL_NETWORK_NAME,
    EXTERNAL_NETWORK_SUBNET,
    PROXY_IMAGE,
    PROXY_PORT,
)
from freejail.core.env import validate_env_vars
from freejail.core.mounts import validate_mounts
from freejail.core.subnet import proxy_ip, subnet_cidr
from freejail.models import ContainerConfig, Mount
from freejail.profile import build_context, dockerfile_path


def _run(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run a podman command, raising on failure if check=True."""
    return subprocess.run(
        ["podman", *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _run_output(args: list[str]) -> str:
    """Run a podman command and return stdout, stripped."""
    result = _run(args)
    return result.stdout.strip()


def image_exists(image: str) -> bool:
    """Check whether a container image exists locally."""
    result = _run(["image", "exists", image], check=False)
    return result.returncode == 0


def ensure_app_image() -> None:
    """Build the freejail app image if it doesn't exist locally."""
    if image_exists(DEFAULT_IMAGE):
        return
    df = dockerfile_path()
    ctx = build_context()
    _run(["build", "-f", str(df), "-t", DEFAULT_IMAGE, str(ctx)])


def ensure_proxy_image() -> None:
    """Pull the mitmproxy image if it doesn't exist locally."""
    if image_exists(PROXY_IMAGE):
        return
    _run(["pull", PROXY_IMAGE])


def ensure_external_network() -> None:
    """Create the shared external network if it doesn't exist."""
    result = _run(
        ["network", "exists", EXTERNAL_NETWORK_NAME],
        check=False,
    )
    if result.returncode != 0:
        _run(
            [
                "network",
                "create",
                "--subnet",
                EXTERNAL_NETWORK_SUBNET,
                EXTERNAL_NETWORK_NAME,
            ]
        )


def create_network(name: str, subnet_index: int) -> str:
    """Create an internal podman network. Returns network name."""
    network_name = f"fj-{name}"
    _run(
        [
            "network",
            "create",
            "--internal",
            "--disable-dns",
            "--subnet",
            subnet_cidr(subnet_index),
            network_name,
        ]
    )
    return network_name


def remove_network(network_name: str) -> None:
    """Remove a podman network (force)."""
    _run(["network", "rm", "-f", network_name], check=False)


def start_proxy(
    name: str,
    network_name: str,
    subnet_index: int,
    ca_dir: str,
    addon_path: str,
    dns_servers: list[str],
) -> str:
    """Start the mitmproxy proxy container. Returns container ID."""
    container_name = f"fj-proxy-{name}"
    ip = proxy_ip(subnet_index)
    args = [
        "run",
        "-d",
        "--replace",
        "--name",
        container_name,
        "--network",
        f"{network_name}:ip={ip}",
        "--network",
        EXTERNAL_NETWORK_NAME,
    ]
    for dns in dns_servers:
        args.extend(["--dns", dns])
    args.extend(
        [
            "-e",
            "PYTHONUNBUFFERED=1",
            "--mount",
            f"type=bind,src={ca_dir},dst=/home/mitmproxy/.mitmproxy,ro",
            "--mount",
            f"type=bind,src={addon_path},dst=/addon.py,ro",
            PROXY_IMAGE,
            "mitmdump",
            "--mode",
            "regular",
            "--listen-port",
            str(PROXY_PORT),
            "--set",
            "connection_strategy=lazy",
            "--set",
            "block_global=false",
            "--set",
            "flow_detail=2",
            "-s",
            "/addon.py",
        ]
    )
    return _run_output(args)


def start_app(
    name: str,
    network_name: str,
    subnet_index: int,
    config: ContainerConfig,
    mounts: list[Mount],
    env_vars: dict[str, str],
    container_env_vars: dict[str, str],
    dns_servers: list[str],
) -> str:
    """Start the app container. Returns container ID."""
    validate_env_vars(env_vars)
    validate_env_vars(container_env_vars)
    validate_mounts(mounts)

    container_name = f"fj-app-{name}"
    ip = proxy_ip(subnet_index)
    proxy_url = f"http://{ip}:{PROXY_PORT}"

    args = [
        "run",
        "-d",
        "--replace",
        "--name",
        container_name,
        "--network",
        network_name,
        "--runtime",
        "runsc",
        "--runtime-flag",
        "ignore-cgroups",
    ]

    for dns in dns_servers:
        args.extend(["--dns", dns])

    # Proxy env vars
    env = {
        "HTTP_PROXY": proxy_url,
        "HTTPS_PROXY": proxy_url,
        "NO_PROXY": "localhost,127.0.0.1",
        **container_env_vars,
        **CA_ENV_VARS,
        **env_vars,
    }
    for k, v in env.items():
        args.extend(["-e", f"{k}={v}"])

    # Mounts
    for m in mounts:
        args.extend(["--mount", f"type=bind,src={m.source},dst={m.target},{m.options}"])

    # Resource limits (only if set)
    if config.resources.memory_mb is not None:
        args.extend(["--memory", f"{config.resources.memory_mb}m"])
    if config.resources.cpu_shares is not None:
        args.extend(["--cpu-shares", str(config.resources.cpu_shares)])
    if config.resources.pids_limit is not None:
        args.extend(["--pids-limit", str(config.resources.pids_limit)])

    # Extra args
    args.extend(config.extra_args)

    # Image and command
    args.append(config.image)
    args.extend(config.command)

    return _run_output(args)


def exec_container(
    name: str,
    cwd_path: str,
    command: list[str],
    container_home: str | None = None,
) -> None:
    """Exec into the app container. Replaces the current process."""
    container_name = f"fj-app-{name}"
    args = ["podman", "exec", "-it", "-w", cwd_path]
    if container_home:
        args.extend(["-e", f"HOME={container_home}"])
    args.extend([container_name, *command])
    os.execvp("podman", args)


def stop_and_remove(container_name: str) -> None:
    """Stop and force-remove a container. Ignores errors."""
    _run(["stop", container_name], check=False)
    _run(["rm", "-f", container_name], check=False)

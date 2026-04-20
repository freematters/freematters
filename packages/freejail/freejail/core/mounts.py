"""Mount resolution: defaults + config + CLI extras."""

import re

from freejail.constants import CA_MOUNT_TARGET
from freejail.models import Mount

_UNSAFE_MOUNT_PATTERN = re.compile(r"[\n\r\x00]")


def validate_mounts(mounts: list[Mount]) -> None:
    """Reject mount source/target/options with characters that break podman format.

    Podman --mount uses comma-separated key=value format, so commas in paths
    corrupt the argument. Newlines and null bytes are never valid in paths.
    """
    for m in mounts:
        for field_name, value in [
            ("source", m.source),
            ("target", m.target),
            ("options", m.options),
        ]:
            if _UNSAFE_MOUNT_PATTERN.search(value):
                raise ValueError(
                    f"Mount {field_name} contains unsafe characters: {value!r}"
                )
            if "," in value and field_name != "options":
                raise ValueError(
                    f"Mount {field_name} contains comma (breaks podman format): {value!r}"
                )


def resolve_mounts(
    cwd: str,
    home_dir: str,
    container_home: str,
    ca_cert_path: str,
    default_mounts: list[Mount],
    config_mounts: list[Mount],
    cli_mounts: list[Mount],
) -> list[Mount]:
    """Build the full mount list: defaults (expanded) + cwd + CA + config + CLI."""
    mounts: list[Mount] = []

    # Expand ~ in default mounts: source uses host home, target uses container home
    for m in default_mounts:
        mounts.append(
            Mount(
                source=m.source.replace("~", home_dir),
                target=m.target.replace("~", container_home),
                options=m.options,
            )
        )

    # Current working directory — same path in container
    mounts.append(Mount(source=cwd, target=cwd, options="rw"))

    # CA certificate
    mounts.append(Mount(source=ca_cert_path, target=CA_MOUNT_TARGET, options="ro"))

    # User config mounts
    mounts.extend(config_mounts)

    # CLI -m mounts
    mounts.extend(cli_mounts)

    return mounts

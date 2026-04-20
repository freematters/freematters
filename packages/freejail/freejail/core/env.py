"""Filter and capture environment variables by prefix."""

import re

_UNSAFE_PATTERN = re.compile(r"[\n\r\x00]")


def validate_env_vars(env: dict[str, str]) -> None:
    """Reject env keys/values containing newlines or null bytes.

    These characters can corrupt the podman -e KEY=VALUE argument format.
    """
    for k, v in env.items():
        if _UNSAFE_PATTERN.search(k):
            raise ValueError(
                f"Environment variable name contains unsafe characters: {k!r}"
            )
        if _UNSAFE_PATTERN.search(v):
            raise ValueError(
                f"Environment variable {k!r} value contains unsafe characters"
            )


def capture_env_vars(
    env: dict[str, str],
    prefixes: list[str],
) -> dict[str, str]:
    """Return env vars matching the given prefixes."""
    return {k: v for k, v in env.items() if any(k.startswith(prefix) for prefix in prefixes)}

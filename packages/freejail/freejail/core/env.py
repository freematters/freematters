"""Filter and capture environment variables by prefix."""


def capture_env_vars(
    env: dict[str, str],
    prefixes: list[str],
) -> dict[str, str]:
    """Return env vars matching the given prefixes."""
    return {k: v for k, v in env.items() if any(k.startswith(prefix) for prefix in prefixes)}

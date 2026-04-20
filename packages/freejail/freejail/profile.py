"""Profile resolution: site/ overrides defaults/ on a per-file basis."""

from pathlib import Path

import yaml

from freejail.models import SiteConfig

_PACKAGE_DIR = Path(__file__).resolve().parent  # freejail/


def resolve_path(relative: str) -> Path:
    """Return site/<relative> if it exists, else defaults/<relative>."""
    site = _PACKAGE_DIR / "site" / relative
    if site.exists():
        return site
    default = _PACKAGE_DIR / "defaults" / relative
    if default.exists():
        return default
    raise FileNotFoundError(f"Not found in site/ or defaults/: {relative}")


def dockerfile_path() -> Path:
    """Resolve the active Dockerfile."""
    return resolve_path("Dockerfile")


def build_context() -> Path:
    """Return the build context directory (freejail_python/)."""
    return _PACKAGE_DIR.parent


def load_config() -> SiteConfig:
    """Load and parse config.yaml from the active profile."""
    path = resolve_path("config.yaml")
    raw = yaml.safe_load(path.read_text()) or {}
    return SiteConfig.model_validate(raw)

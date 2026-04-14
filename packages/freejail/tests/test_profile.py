import pytest

import freejail.profile as profile
from freejail.profile import dockerfile_path, load_config, resolve_path


def test_resolve_path_finds_site_first(tmp_path, monkeypatch):
    """site/ takes priority over defaults/."""
    site = tmp_path / "site"
    defaults = tmp_path / "defaults"
    site.mkdir()
    defaults.mkdir()
    (site / "config.yaml").write_text("site")
    (defaults / "config.yaml").write_text("defaults")

    monkeypatch.setattr(profile, "_PACKAGE_DIR", tmp_path)

    result = resolve_path("config.yaml")
    assert result == site / "config.yaml"
    assert result.read_text() == "site"


def test_resolve_path_falls_back_to_defaults(tmp_path, monkeypatch):
    """Falls back to defaults/ when site/ doesn't have the file."""
    defaults = tmp_path / "defaults"
    defaults.mkdir()
    (defaults / "config.yaml").write_text("defaults")

    monkeypatch.setattr(profile, "_PACKAGE_DIR", tmp_path)

    result = resolve_path("config.yaml")
    assert result == defaults / "config.yaml"


def test_resolve_path_raises_when_missing(tmp_path, monkeypatch):
    """Raises FileNotFoundError when not in site/ or defaults/."""
    monkeypatch.setattr(profile, "_PACKAGE_DIR", tmp_path)

    with pytest.raises(FileNotFoundError):
        resolve_path("nonexistent.yaml")


def test_load_config_parses_yaml(tmp_path, monkeypatch):
    """Loads and parses a config.yaml into SiteConfig."""
    defaults = tmp_path / "defaults"
    defaults.mkdir()
    (defaults / "config.yaml").write_text("""
egress:
  allowed:
    - host: example.com
  rewrites: []
env_vars:
  FOO: bar
mounts:
  - source: "~/.claude"
    target: "~/.claude"
    options: rw
captured_env_prefixes:
  - FOO_
""")

    monkeypatch.setattr(profile, "_PACKAGE_DIR", tmp_path)

    cfg = load_config()
    assert len(cfg.egress.allowed) == 1
    assert cfg.egress.allowed[0].host == "example.com"
    assert cfg.env_vars == {"FOO": "bar"}
    assert len(cfg.mounts) == 1
    assert cfg.captured_env_prefixes == ["FOO_"]


def test_dockerfile_path_resolves(tmp_path, monkeypatch):
    """dockerfile_path() resolves from site/ or defaults/."""
    defaults = tmp_path / "defaults"
    defaults.mkdir()
    (defaults / "Dockerfile").write_text("FROM ubuntu:22.04")

    monkeypatch.setattr(profile, "_PACKAGE_DIR", tmp_path)

    assert dockerfile_path() == defaults / "Dockerfile"

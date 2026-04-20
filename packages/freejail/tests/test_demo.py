"""Smoke test to verify package structure works."""

from freejail import __doc__


def test_package_importable():
    assert "freejail" in __doc__

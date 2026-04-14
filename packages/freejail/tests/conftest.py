import pytest


@pytest.fixture
def tmp_data_dir(tmp_path):
    """Provide a temporary ~/.freejail equivalent."""
    return tmp_path / "freejail"

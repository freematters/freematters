import pytest

from freejail.core.subnet import next_subnet_index, proxy_ip, subnet_cidr


def test_first_available():
    assert next_subnet_index(set()) == 1


def test_skips_used():
    assert next_subnet_index({1, 2, 3}) == 4


def test_fills_gaps():
    assert next_subnet_index({1, 3, 5}) == 2


def test_all_used():
    used = set(range(1, 256))
    with pytest.raises(ValueError, match="no available subnet"):
        next_subnet_index(used)


def test_subnet_cidr():
    assert subnet_cidr(1) == "21.18.1.0/24"
    assert subnet_cidr(42) == "21.18.42.0/24"


def test_proxy_ip():
    assert proxy_ip(1) == "21.18.1.2"
    assert proxy_ip(42) == "21.18.42.2"

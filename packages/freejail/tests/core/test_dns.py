from freejail.core.dns import parse_nameservers


def test_extracts_nameservers():
    content = """\
# comment
nameserver 8.8.8.8
nameserver 1.1.1.1
search example.com
"""
    assert parse_nameservers(content) == ["8.8.8.8", "1.1.1.1"]


def test_filters_loopback():
    content = """\
nameserver 127.0.0.53
nameserver 8.8.8.8
nameserver 127.0.0.1
"""
    assert parse_nameservers(content) == ["8.8.8.8"]


def test_empty_content():
    assert parse_nameservers("") == []


def test_only_loopback():
    content = "nameserver 127.0.0.53\n"
    assert parse_nameservers(content) == []

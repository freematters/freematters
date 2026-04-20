"""Parse resolv.conf for nameserver IPs."""


def parse_nameservers(content: str) -> list[str]:
    """Extract nameserver IPs, filtering out loopback addresses."""
    result: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped.startswith("nameserver"):
            continue
        parts = stripped.split()
        if len(parts) < 2:
            continue
        ip = parts[1]
        if ip.startswith("127."):
            continue
        result.append(ip)
    return result

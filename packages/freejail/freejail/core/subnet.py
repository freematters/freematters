"""Subnet allocation for container networks."""

from freejail.constants import SUBNET_MAX, SUBNET_MIN, SUBNET_PREFIX


def next_subnet_index(used: set[int]) -> int:
    """Return the lowest available subnet index in [SUBNET_MIN, SUBNET_MAX]."""
    for i in range(SUBNET_MIN, SUBNET_MAX + 1):
        if i not in used:
            return i
    raise ValueError("no available subnet")


def subnet_cidr(index: int) -> str:
    """Return the CIDR for a given subnet index, e.g. '21.18.1.0/24'."""
    return f"{SUBNET_PREFIX}.{index}.0/24"


def proxy_ip(index: int) -> str:
    """Return the static proxy IP for a given subnet index."""
    return f"{SUBNET_PREFIX}.{index}.2"

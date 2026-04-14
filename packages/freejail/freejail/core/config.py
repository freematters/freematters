"""YAML config parsing and egress policy merging."""

import yaml

from freejail.models import ContainerConfig, EgressPolicy, EgressRewrite


def parse_config_yaml(content: str) -> ContainerConfig:
    """Parse a YAML config string into ContainerConfig."""
    if not content or not content.strip():
        return ContainerConfig()
    data = yaml.safe_load(content)
    if not data:
        return ContainerConfig()
    return ContainerConfig.model_validate(data)


def merge_egress(baseline: EgressPolicy, user: EgressPolicy) -> EgressPolicy:
    """Merge baseline and user egress policies.

    Allowed hosts: union, deduplicated by host string.
    Rewrites: union, user wins on from_host conflict.
    """
    # Allowed: union by host
    seen_hosts: set[str] = set()
    merged_allowed = []
    for rule in [*baseline.allowed, *user.allowed]:
        if rule.host not in seen_hosts:
            seen_hosts.add(rule.host)
            merged_allowed.append(rule)

    # Rewrites: user wins on conflict
    rewrite_map: dict[str, EgressRewrite] = {}
    for rw in baseline.rewrites:
        rewrite_map[rw.from_host] = rw
    for rw in user.rewrites:
        rewrite_map[rw.from_host] = rw  # user overwrites baseline
    merged_rewrites = list(rewrite_map.values())

    return EgressPolicy(allowed=merged_allowed, rewrites=merged_rewrites)

from freejail.core.config import merge_egress, parse_config_yaml
from freejail.models import ContainerConfig, EgressPolicy, EgressRewrite, EgressRule


def test_parse_minimal_yaml():
    yaml_content = """\
egress:
  allowed:
    - host: custom.example.com
"""
    cfg = parse_config_yaml(yaml_content)
    assert isinstance(cfg, ContainerConfig)
    assert len(cfg.egress.allowed) == 1
    assert cfg.egress.allowed[0].host == "custom.example.com"


def test_parse_empty_yaml():
    cfg = parse_config_yaml("")
    assert cfg == ContainerConfig()


def test_parse_full_yaml():
    yaml_content = """\
image: custom:latest
command:
  - bash
mounts:
  - source: /data
    target: /data
    options: ro
egress:
  allowed:
    - host: example.com
  rewrites:
    - from_host: pkg.dev
      to_url: mirror.example.com/pkg/
resources:
  cpu_shares: 512
  memory_mb: 1024
  pids_limit: 200
"""
    cfg = parse_config_yaml(yaml_content)
    assert cfg.image == "custom:latest"
    assert cfg.command == ["bash"]
    assert len(cfg.mounts) == 1
    assert cfg.resources.cpu_shares == 512


def test_merge_egress_union_allowed():
    baseline = EgressPolicy(allowed=[EgressRule(host="a.com"), EgressRule(host="b.com")])
    user = EgressPolicy(allowed=[EgressRule(host="b.com"), EgressRule(host="c.com")])
    merged = merge_egress(baseline, user)
    hosts = {r.host for r in merged.allowed}
    assert hosts == {"a.com", "b.com", "c.com"}


def test_merge_egress_union_rewrites():
    baseline = EgressPolicy(rewrites=[EgressRewrite(from_host="github.com", to_url="mirror1.com/github/")])
    user = EgressPolicy(rewrites=[EgressRewrite(from_host="npm.org", to_url="mirror1.com/npm/")])
    merged = merge_egress(baseline, user)
    from_hosts = {r.from_host for r in merged.rewrites}
    assert from_hosts == {"github.com", "npm.org"}


def test_merge_egress_user_wins_rewrite_conflict():
    baseline = EgressPolicy(rewrites=[EgressRewrite(from_host="github.com", to_url="old-mirror.com/github/")])
    user = EgressPolicy(rewrites=[EgressRewrite(from_host="github.com", to_url="new-mirror.com/github/")])
    merged = merge_egress(baseline, user)
    assert len(merged.rewrites) == 1
    assert merged.rewrites[0].to_url == "new-mirror.com/github/"

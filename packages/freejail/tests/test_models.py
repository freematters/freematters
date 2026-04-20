import json
from datetime import UTC, datetime

from freejail.models import (
    ContainerConfig,
    ContainerRecord,
    EgressPolicy,
    EgressRewrite,
    EgressRule,
    Mount,
    Resources,
)


def test_egress_rule_from_dict():
    rule = EgressRule(host="api.anthropic.com")
    assert rule.host == "api.anthropic.com"


def test_egress_rewrite_defaults():
    rw = EgressRewrite(from_host="github.com", to_url="mirror.example.com/github/")
    assert rw.headers == {}


def test_egress_policy_empty_default():
    policy = EgressPolicy()
    assert policy.allowed == []
    assert policy.rewrites == []


def test_mount_default_options():
    m = Mount(source="/a", target="/b")
    assert m.options == "rw"


def test_resources_default_no_limits():
    r = Resources()
    assert r.cpu_shares is None
    assert r.memory_mb is None
    assert r.pids_limit is None


def test_container_config_defaults():
    cfg = ContainerConfig()
    assert cfg.image == "freematters/freejail:local_latest"
    assert cfg.command == ["sleep", "infinity"]
    assert cfg.mounts == []
    assert cfg.egress == EgressPolicy()
    assert cfg.resources == Resources()
    assert cfg.extra_args == []


def test_container_record_serialization():
    now = datetime.now(tz=UTC)
    record = ContainerRecord(
        id=1,
        name="test",
        tracked=True,
        app_container_id="abc123",
        proxy_container_id="def456",
        network_name="fj-test",
        subnet_index=1,
        config_path=None,
        cli_mounts=[],
        mounts=[Mount(source="/a", target="/b", options="ro")],
        env_vars={"ANTHROPIC_API_KEY": "sk-test"},
        cwd_path="/home/user/project",
        created_at=now,
    )
    assert record.tracked is True
    mounts_json = json.dumps([m.model_dump() for m in record.mounts])
    parsed = json.loads(mounts_json)
    assert parsed[0]["source"] == "/a"

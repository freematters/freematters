from freejail.core.egress import generate_addon_script
from freejail.models import EgressPolicy, EgressRewrite, EgressRule


def test_generates_valid_python():
    policy = EgressPolicy(
        allowed=[EgressRule(host="api.anthropic.com")],
        rewrites=[
            EgressRewrite(
                from_host="github.com",
                to_url="mirror.example.com/github/",
                headers={"X-Token": "abc"},
            )
        ],
    )
    script = generate_addon_script(policy, "test-tenant")
    compile(script, "<addon>", "exec")


def test_contains_allowed_hosts():
    policy = EgressPolicy(
        allowed=[
            EgressRule(host="api.anthropic.com"),
            EgressRule(host="example.com"),
        ],
    )
    script = generate_addon_script(policy, "test")
    assert '"api.anthropic.com"' in script
    assert '"example.com"' in script


def test_contains_rewrites():
    policy = EgressPolicy(
        rewrites=[
            EgressRewrite(
                from_host="github.com",
                to_url="mirror.example.com/github/",
            )
        ],
    )
    script = generate_addon_script(policy, "test")
    assert '"github.com"' in script
    assert '"mirror.example.com/github/"' in script


def test_contains_block_response():
    policy = EgressPolicy(allowed=[EgressRule(host="allowed.com")])
    script = generate_addon_script(policy, "test")
    assert "403" in script
    assert "Blocked" in script


def test_empty_policy():
    policy = EgressPolicy()
    script = generate_addon_script(policy, "test")
    compile(script, "<addon>", "exec")
    assert "ALLOWED_HOSTS" in script
    assert "REWRITES" in script


def test_contains_http_connect_hook():
    policy = EgressPolicy(allowed=[EgressRule(host="allowed.com")])
    script = generate_addon_script(policy, "test")
    assert "http_connect" in script
    assert "_is_allowed" in script

import sys
import types
from dataclasses import dataclass, field

import pytest
from freejail.core.egress import generate_addon_script
from freejail.models import EgressPolicy, EgressRewrite, EgressRule


@dataclass
class _FakeRequest:
    host: str
    port: int
    path: str
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class _FakeFlow:
    request: _FakeRequest
    response: object | None = None


class _FakeResponse:
    @staticmethod
    def make(status_code, body, headers):
        return ("response", status_code, body, headers)


@pytest.fixture
def addon_runtime(monkeypatch):
    """Exec a generated addon script with a stubbed mitmproxy.http module.

    Returns a factory that takes an EgressPolicy and yields the JailEgress
    instance from the executed script.
    """
    fake_http = types.SimpleNamespace(HTTPFlow=_FakeFlow, Response=_FakeResponse)
    fake_mitmproxy = types.ModuleType("mitmproxy")
    fake_mitmproxy.http = fake_http  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "mitmproxy", fake_mitmproxy)
    monkeypatch.setitem(sys.modules, "mitmproxy.http", fake_http)

    def _build(policy: EgressPolicy):
        script = generate_addon_script(policy, "test")
        ns: dict = {}
        exec(compile(script, "<addon>", "exec"), ns)  # noqa: S102
        return ns["JailEgress"]()

    return _build


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


def _rewrite_policy(to_url: str) -> EgressPolicy:
    return EgressPolicy(rewrites=[EgressRewrite(from_host="github.com", to_url=to_url)])


def test_rewrite_path_with_trailing_slash(addon_runtime):
    egress = addon_runtime(_rewrite_policy("mirror.example.com/github/"))
    flow = _FakeFlow(request=_FakeRequest(host="github.com", port=443, path="/foo/bar"))
    egress.request(flow)
    assert flow.response is None
    assert flow.request.host == "mirror.example.com"
    assert flow.request.path == "/github/foo/bar"


def test_rewrite_path_without_trailing_slash(addon_runtime):
    """Regression: previously produced '/githubfoo/bar' (missing separator)."""
    egress = addon_runtime(_rewrite_policy("mirror.example.com/github"))
    flow = _FakeFlow(request=_FakeRequest(host="github.com", port=443, path="/foo/bar"))
    egress.request(flow)
    assert flow.request.host == "mirror.example.com"
    assert flow.request.path == "/github/foo/bar"


def test_rewrite_path_with_empty_prefix(addon_runtime):
    """to_url with only a host (no path) leaves the request path unchanged."""
    egress = addon_runtime(_rewrite_policy("mirror.example.com/"))
    flow = _FakeFlow(request=_FakeRequest(host="github.com", port=443, path="/foo/bar"))
    egress.request(flow)
    assert flow.request.host == "mirror.example.com"
    assert flow.request.path == "/foo/bar"


def test_rewrite_path_host_only(addon_runtime):
    """to_url without any slash leaves the request path unchanged."""
    egress = addon_runtime(_rewrite_policy("mirror.example.com"))
    flow = _FakeFlow(request=_FakeRequest(host="github.com", port=443, path="/foo/bar"))
    egress.request(flow)
    assert flow.request.host == "mirror.example.com"
    assert flow.request.path == "/foo/bar"

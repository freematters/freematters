"""Generate mitmproxy addon script from egress policy."""

import json

from freejail.models import EgressPolicy


def generate_addon_script(policy: EgressPolicy, tenant_name: str) -> str:
    """Generate the mitmproxy addon Python script as a string."""
    allowed_hosts_literal = "{\n" + "".join(f"    {json.dumps(rule.host)},\n" for rule in policy.allowed) + "}"

    def _rewrite_entry(rw):
        to = json.dumps(rw.to_url)
        hdrs = json.dumps(rw.headers)
        return f'    {json.dumps(rw.from_host)}: {{"to_url": {to}, "headers": {hdrs}}},\n'

    rewrites_literal = "{\n" + "".join(_rewrite_entry(rw) for rw in policy.rewrites) + "}"

    return f'''\
"""Jail egress policy for {tenant_name}. Auto-generated — do not edit."""

from mitmproxy import http

ALLOWED_HOSTS = {allowed_hosts_literal}

REWRITES = {rewrites_literal}

# Podman-internal names reachable from fj-external — always blocked.
BLOCKED_HOSTS = {{
    "host.containers.internal",
    "gateway.containers.internal",
}}


ALLOWED_PORTS = {{80, 443}}


def _is_allowed(host: str, port: int) -> bool:
    if host in BLOCKED_HOSTS:
        return False
    if port not in ALLOWED_PORTS:
        return False
    return host in ALLOWED_HOSTS or host in REWRITES


def _block(flow: http.HTTPFlow, host: str, port: int) -> None:
    flow.response = http.Response.make(
        403,
        f"Blocked by fj policy: {{host}}:{{port}} not allowed",
        {{"Content-Type": "text/plain"}},
    )


class JailEgress:
    def http_connect(self, flow: http.HTTPFlow) -> None:
        """Block CONNECT tunnels to disallowed hosts/ports before establishment."""
        host = flow.request.host
        port = flow.request.port
        if not _is_allowed(host, port):
            _block(flow, host, port)

    def request(self, flow: http.HTTPFlow) -> None:
        """Filter HTTP requests by actual upstream host and port."""
        host = flow.request.host
        port = flow.request.port

        if not _is_allowed(host, port):
            _block(flow, host, port)
            return

        if host in REWRITES:
            rule = REWRITES[host]
            parts = rule["to_url"].split("/", 1)
            flow.request.host = parts[0]
            if len(parts) > 1:
                flow.request.path = "/" + parts[1] + flow.request.path.lstrip("/")
            for k, v in rule.get("headers", {{}}).items():
                flow.request.headers[k] = v


addons = [JailEgress()]
'''

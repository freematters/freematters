# fj — User Guide

`fj` creates isolated container sandboxes with egress filtering, gVisor isolation, and TLS-intercepting proxy.

## Prerequisites

- **podman** — container runtime
- **runsc** (gVisor) — sandbox runtime, must be configured as a podman runtime

Both are checked at startup. If missing, `fj` exits with a clear error.

## Quick Start

```bash
# Create a sandbox named "work"
fj apply work

# Exec into it (default command: claude)
fj exec work

# Exec with a different command
fj exec work bash

# List all sandboxes
fj ls

# Restart (tear down + recreate with same config)
fj restart work

# Remove
fj rm work
```

## Custom Configuration

Pass a YAML config file with `-f`:

```bash
fj apply work -f my-config.yaml
```

Example `my-config.yaml`:

```yaml
image: localhost/my-image:latest
command: ["sleep", "infinity"]

egress:
  allowed:
    - host: api.example.com
    - host: registry.npmjs.org

mounts:
  - source: /data/shared
    target: /data/shared
    options: ro

resources:
  memory_mb: 4096
  cpu_shares: 1024
  pids_limit: 256
```

User config egress rules are merged with the profile baseline — you don't need to repeat the defaults.

## Extra Mounts

Add mounts via CLI without a config file:

```bash
fj apply work -m /host/path:/container/path
fj apply work -m /host/path:/container/path:ro
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `FJ_DATA_DIR` | Override data directory | `~/.freejail` |

Environment variables matching prefixes defined in the profile config (e.g., `ANTHROPIC_*`, `CLAUDE_CODE_*`) are automatically forwarded into the container.

## What Gets Created

For each sandbox, `fj apply` creates:

1. **Internal network** (`fj-<name>`) — isolated, no DNS, no internet
2. **Proxy container** (`fj-proxy-<name>`) — mitmproxy on the internal + external network, enforcing the egress allowlist
3. **App container** (`fj-app-<name>`) — your workspace, routed through the proxy via `HTTP_PROXY`/`HTTPS_PROXY`

```
                    ┌──────────────────────┐
                    │   fj-external net    │──── internet
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │   fj-proxy-<name>    │
                    │   (mitmproxy egress  │
                    │    allowlist filter) │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │   fj-<name> net      │  (--internal)
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │   fj-app-<name>      │
                    │   (gVisor isolated)  │
                    └──────────────────────┘
```

## Default Mounts

These are configured in the profile's `config.yaml` and auto-mounted:

- `~/.claude` → `~/.claude`
- `~/.codex` → `~/.codex`
- `~/.claude.json` → `~/.claude.json`
- Current working directory → same path inside container

The `~` placeholder resolves to your actual home directory on both sides.

## User Mapping

The container runs as root (UID 0) for full privileges, but the username and home directory are remapped to match your host user:

```bash
# On host as ubuntu with home /home/ubuntu:
fj exec work whoami          # → ubuntu
fj exec work bash -c 'echo $HOME'  # → /home/ubuntu

# On host as root with home /root:
fj exec work whoami          # → root
fj exec work bash -c 'echo $HOME'  # → /root
```

## Egress Policy

The proxy enforces three security layers:

1. **Host blocklist** — podman-internal names are always blocked
2. **Port allowlist** — only ports 80 and 443 are permitted
3. **Host allowlist** — only explicitly listed hosts can be reached

Blocked requests return HTTP 403. The filter uses the actual connection target, not the `Host` header, preventing spoofing.

## Profile Customization

`fj` loads configuration from two directories inside the package:

- **`freejail/site/`** — private overrides (takes priority)
- **`freejail/defaults/`** — shipped defaults (fallback)

Each can contain:
- `Dockerfile` — container image definition
- `config.yaml` — egress rules, env vars, mounts, captured prefixes

To customize, create files in `site/`. Any file not present falls back to `defaults/`.

## Data Directory

All persistent data lives in `~/.freejail/` (or `$FJ_DATA_DIR`):

```
~/.freejail/
  freejail.db          # SQLite database (container records)
  ca/                  # Generated CA certificates
  run/<name>/          # Per-sandbox runtime files (addon scripts)
```

## Troubleshooting

```bash
# Check if dependencies are available
which podman runsc

# Check proxy logs for egress issues
podman logs fj-proxy-<name>

# Inspect container state
podman ps -a --filter name=fj-

# Force cleanup if fj rm fails
podman rm -f fj-app-<name> fj-proxy-<name>
podman network rm -f fj-<name>
```

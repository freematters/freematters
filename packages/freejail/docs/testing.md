# Testing freejail

## Prerequisites

- **podman** with gVisor (`runsc`) runtime installed
- **`localhost/freejail:latest`** image built from the project Dockerfile
- **`docker.io/mitmproxy/mitmproxy:latest`** pulled

### Build the freejail image

```bash
cd freejail/
podman build -t localhost/freejail:latest .
```

### Pull mitmproxy

```bash
podman pull docker.io/mitmproxy/mitmproxy:latest
```

## Unit Tests

Unit tests cover all pure `core/` modules and the `shell/db.py` module. They don't need podman or any container runtime.

```bash
cd /path/to/freeman
PYTHONPATH=freejail/freejail:$PYTHONPATH .venv/bin/pytest freejail/freejail/tests/ -v
```

Expected: 45 tests, all pass.

### What's covered

| Module | Tests | What they verify |
|--------|-------|------------------|
| `models` | 7 | Pydantic defaults, serialization round-trip |
| `core/env` | 4 | `ANTHROPIC_*`/`CLAUDE_CODE_*` prefix filtering |
| `core/dns` | 4 | resolv.conf parsing, loopback filtering |
| `core/subnet` | 6 | Lowest-available allocation, gap filling, exhaustion error |
| `core/mounts` | 5 | `~` expansion, cwd mount, CA mount, config/CLI append order |
| `core/config` | 6 | YAML parsing, egress merge (union, user-wins-conflict) |
| `core/egress` | 5 | Addon script validity (compiles), allowed/rewrite/block content |
| `shell/db` | 8 | Insert, get, untrack, list, subnet indices, name uniqueness, reuse, schema version |

## Manual E2E Testing

These tests require a running podman with gVisor and both images available.

### 1. Basic apply + exec + rm cycle

```bash
# Set your Anthropic key so it gets captured
export ANTHROPIC_API_KEY="sk-ant-..."

# Create a container (no config file — uses all defaults)
cd /your/working/directory
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply test1

# Verify it's tracked
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail ls

# Expected: table with test1, subnet 21.18.1.0/24, your cwd

# Exec into the container (runs claude by default)
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail exec test1

# Or run a custom command
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail exec test1 bash

# Verify you're in the right directory inside the container:
#   pwd → should match your host cwd
#   echo $ANTHROPIC_API_KEY → should be set
#   echo $HTTP_PROXY → should be http://21.18.1.2:8080
#   echo $IS_SANDBOX → should be 1

# Remove
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail rm test1
```

### 2. Egress policy verification

```bash
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply egress-test

PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail exec egress-test bash
```

Inside the container:

```bash
# Should succeed — api.anthropic.com is in baseline allowlist
curl -s https://api.anthropic.com/ ; echo $?

# Should fail with 403 — random host not in allowlist
curl -s https://example.com/ ; echo $?
# Expected: "Blocked by fj policy: example.com not in allowlist"

# Should succeed — archive.ubuntu.com is in baseline allowlist
curl -s http://archive.ubuntu.com/ ; echo $?
```

Clean up:
```bash
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail rm egress-test
```

### 3. Custom config file

Create a test config:

```yaml
# /tmp/test-config.yaml
egress:
  allowed:
    - host: "example.com"
resources:
  memory_mb: 1024
```

```bash
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply custom-test -f /tmp/test-config.yaml

PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail exec custom-test bash
```

Inside:
```bash
# Should now succeed — example.com added via user config
curl -s https://example.com/ ; echo $?

# Baseline hosts should still work too
curl -s https://api.anthropic.com/ ; echo $?
```

Clean up:
```bash
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail rm custom-test
```

### 4. Extra mounts via -m

```bash
mkdir -p /tmp/test-mount && echo "hello" > /tmp/test-mount/file.txt

PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply mount-test -m "/tmp/test-mount:/tmp/test-mount"

PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail exec mount-test bash
```

Inside:
```bash
cat /tmp/test-mount/file.txt
# Expected: hello
```

Clean up:
```bash
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail rm mount-test
```

### 5. Name conflict and reuse

```bash
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply dup-test

# Should error — name already tracked
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply dup-test
# Expected: Error: 'dup-test' is already tracked. Run 'fj rm dup-test' first.

# Remove and re-apply — should succeed
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail rm dup-test

PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply dup-test

# Clean up
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail rm dup-test
```

### 6. CA certificate generation

```bash
# On first apply, CA should be auto-generated
ls ~/.freejail/ca/
# Expected: fj-ca.pem  fj-ca-key.pem  mitmproxy-ca.pem

# Verify it's a valid cert
openssl x509 -in ~/.freejail/ca/fj-ca.pem -text -noout | head -10
# Expected: CN = freejail-headless-ca, CA:TRUE
```

### 7. Multiple containers (subnet isolation)

```bash
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply multi-1

PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail apply multi-2

PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail ls
# Expected: multi-1 at 21.18.1.0/24, multi-2 at 21.18.2.0/24

# Verify network isolation — containers should NOT reach each other
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail exec multi-1 bash -c "ping -c1 21.18.2.2"
# Expected: unreachable (separate internal networks)

# Clean up
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail rm multi-1
PYTHONPATH=freejail/freejail:$PYTHONPATH \
  python -m freejail rm multi-2
```

## Inspecting State

### SQLite database

```bash
sqlite3 ~/.freejail/freejail.db "SELECT id, name, tracked, subnet_index, cwd_path FROM containers"
```

### Podman containers

```bash
podman ps -a --filter "name=fj-" --format "{{.Names}} {{.State}}"
```

### Podman networks

```bash
podman network ls --filter "name=fj-"
```

### Generated addon script

```bash
cat ~/.freejail/run/<name>/addon.py
```

## Cleanup

Remove all fj resources:

```bash
# Remove all fj containers
podman ps -a --filter "name=fj-" --format "{{.Names}}" | xargs -r podman rm -f

# Remove all fj networks
podman network ls --filter "name=fj-" --format "{{.Name}}" | xargs -r podman network rm -f

# Remove data directory
rm -rf ~/.freejail/
```

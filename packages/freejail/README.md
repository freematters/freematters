# freejail

Daemonless container sandboxing CLI with mitmproxy-based egress policy enforcement.

Provides network isolation for AI coding agents without requiring KVM — runs on any Linux host with podman and gVisor.

## Prerequisites

- [podman](https://podman.io/) (rootless, static binary)
- [gVisor](https://gvisor.dev/) (`runsc` runtime registered with podman)

### Install podman (static binary)

```bash
wget -O podman.tar.gz https://github.com/mgoltzsche/podman-static/releases/latest/download/podman-linux-amd64.tar.gz
tar xf podman.tar.gz
sudo cp -rn podman-linux-amd64/usr/* /usr/
```

### Install gVisor (runsc)

```bash
sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null
sudo apt-get update && sudo apt-get install -y runsc
```

## Install

```bash
uv tool install freejail
```

## Usage

```bash
fj apply <name> [-f config.yaml]   # create and start a sandboxed container
fj ls                               # list tracked containers
fj exec <name> [command...]         # exec into a container (default: claude)
fj rm <name>                        # stop and remove a container
fj restart <name>                   # rm + apply with same config
```

## Architecture

Dual-container model per sandbox:

- **App container** — runs the user workload under gVisor (`runsc`)
- **Proxy container** — runs mitmproxy enforcing egress policy (allowed hosts, URL rewrites)

Traffic from the app container routes through the proxy. No direct internet access.

```
┌─────────────┐      ┌───────────────┐
│ app (runsc)  │─────▶│ proxy (mitm)  │──▶ internet
└─────────────┘      └───────────────┘
     fj-app-<name>        fj-proxy-<name>
```

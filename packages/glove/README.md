# glove

Remote shell-exec + file-transfer over zero-config TryCloudflare quick tunnels.

Operator runs `glove start` on a laptop; the remote Linux box onboards with a
single `curl … | sh` one-liner. After that, `glove exec`, `glove push`,
`glove pull`, and `glove list` work over an authenticated wss tunnel. No
public DNS, no SSH key exchange, no GitHub release artifacts.

## Quick Start

```bash
# Operator laptop
cargo install --path .                     # builds release binary (~2.3 MiB)
glove start                                # prints install one-liner + LAN fallback URL

# Remote Linux target — paste the printed one-liner
GLOVE_NAME=lab1 curl -fsSL '<INSTALL_URL>' | sh

# Back on the operator laptop
glove list
glove exec lab1 -- uname -a
glove push lab1 ./local.bin /tmp/x.bin
glove pull lab1 /tmp/x.bin ./back.bin
```

Real-mode needs `cloudflared` on `$PATH`. Use `glove start --local` for an
offline, `127.0.0.1`-only mode (handy for CI and local dev).

## Build & Test

```bash
cargo build --release
cargo test --release                       # LOCAL_MODE end-to-end suite
cargo test --release --test e2e_real_smoke \
  -- --ignored --nocapture                 # real-mode smoke (opt-in)
```

See [AGENTS.md](AGENTS.md) for architecture, protocol details, and the full
module map.

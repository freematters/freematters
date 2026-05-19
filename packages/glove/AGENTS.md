# glove

Remote shell-exec + file-transfer agent. A single Rust binary that runs both
sides of a control channel: a `glove start` server on the operator's laptop
and a `glove _client` daemon on the remote Linux box, joined via a zero-config
TryCloudflare quick tunnel (wss, token-authenticated).

The remote side onboards with a single `curl … | sh` one-liner that downloads
the binary served by the local server and starts the daemon under
`setsid + nohup`. No GitHub release, no SSH key exchange, no public DNS.

## Build & Test

```bash
cargo build --release                       # produces target/release/glove (~2.3 MiB)
cargo test --release                        # LOCAL_MODE end-to-end suite (no network)
cargo test --release --test e2e_real_smoke \
  -- --ignored --nocapture                  # real-mode smoke (TryCloudflare, opt-in)
```

`cargo test --release` runs the six LOCAL_MODE tests (`e2e_t1_install` …
`e2e_t6_unauth`). The real-mode smoke test is `#[ignore]`-d because it depends
on the public Internet and TryCloudflare's per-IP rate limit — invoke it
manually for final verification.

**Real-mode requires `cloudflared` on `$PATH`** (or in the workspace next to
`Cargo.toml`, or pointed at via `$GLOVE_CLOUDFLARED`). LOCAL_MODE does not.

## Architecture

```
glove start (operator laptop)                   glove _client (remote linux)
  ├── server::tunnel  ──> cloudflared subproc      ┌─> connects wss://*.trycloudflare.com/ws
  ├── server::http    (axum)                       │     with token in ClientHello
  │     ├── GET /            "glove server"        │
  │     ├── GET /install     install one-liner ────┘
  │     ├── GET /bin         self-binary download
  │     └── GET /ws          upgrade to WebSocket
  ├── server::ws      (ClientHello/ServerHello,
  │                    heartbeat, dispatch)
  ├── server::ctl     (unix-socket IPC for the
  │                    sibling CLI subcommands)
  └── server::state   (per-name ClientConn, mpsc)

glove list / exec / push / pull (CLI on operator side)
  └── connects ctl socket → routed to client over wss
```

### Wire protocols

- **WebSocket**: JSON text frames for control (`ClientHello`, `ServerHello`,
  `Ping/Pong`, `ExecRequest/Response`, `PushBegin/Ack/Done`, `PullRequest/
  Begin/Error`, `TransferEnd`) plus binary frames with a 13-byte header
  (`transfer_id: u64`, `seq: u32`, `flags: u8`) for chunked file payloads.
- **Unix socket** (`$GLOVE_STATE_DIR/control.sock`): length-prefixed framing
  (`u32 LE len`, `u8 tag`, `payload`), `TAG_JSON=0` / `TAG_CHUNK=1`.

### Key modules

| Module | Purpose |
|--------|---------|
| `src/cli.rs` | clap subcommand dispatch (`start`, `list`, `exec`, `push`, `pull`, hidden `_client`) |
| `src/server/mod.rs` | `run_start` entry; cloudflared bootstrap; CTL clients (`ctl_list`/`ctl_exec`/`ctl_push`/`ctl_pull`); LAN-IP fallback URL |
| `src/server/tunnel.rs` | `cloudflared tunnel --url http://127.0.0.1:port` wrapper, log-ring with 429/rate-limit summarization, EPIPE-safe pipe draining |
| `src/server/ws.rs` | ClientHello validation, constant-time token check, duplicate-name takeover, heartbeat (ping every 2s, offline after 5s no msg) |
| `src/server/http.rs` | axum router (`/`, `/install`, `/bin`, `/ws`) |
| `src/server/ctl.rs` | unix-socket dispatcher: CtlReq → ws send → wait for pending response |
| `src/server/state.rs` | `ClientStatus`, `ClientConn` (mpsc tx + generation), `PendingExec/Push/Pull` |
| `src/client/mod.rs` | reconnect loop with exponential backoff (capped at 15s); auth-failure is fatal (exit code 2) |
| `src/client/exec.rs` | `tokio::process::Command` runner capturing stdout/stderr/exit |
| `src/client/files.rs` | `PushReceiver` (md5-rolled + length-checked) and `handle_pull` (md5 + chunked stream) |
| `src/proto.rs` | `Msg` / `CtlReq` / `CtlResp` enums; `encode_chunk`/`decode_chunk`; `CHUNK_PAYLOAD_SIZE = 64 KiB` |
| `src/install.rs` | embedded shell-script template for the install one-liner |
| `src/state.rs` | `state_dir()` resolution (`$GLOVE_STATE_DIR` → `$XDG_CACHE_HOME/glove` → `$HOME/.cache/glove` → `/tmp`) |

## Usage

### Start the server (operator's laptop)

```bash
glove start
```

Prints machine-parseable header lines followed by a human-readable install
hint. In real mode (default) two install URLs are surfaced — the public
TryCloudflare HTTPS URL and a same-token LAN HTTP URL — so the operator can
pick whichever is reachable from the target:

```
BIND 0.0.0.0:54123
TOKEN <64-hex>
HTTP_URL https://<random>.trycloudflare.com
WS_URL wss://<random>.trycloudflare.com/ws
INSTALL_URL https://<random>.trycloudflare.com/install?token=<64-hex>
LAN_HTTP_URL http://192.168.1.42:54123
LAN_INSTALL_URL http://192.168.1.42:54123/install?token=<64-hex>

install command (run on target Linux box):
  curl -fsSL '<INSTALL_URL>' | sh
  # or, if the target is on the same LAN:
  curl -fsSL '<LAN_INSTALL_URL>' | sh
```

Use `--local` for `127.0.0.1`-only mode (skips cloudflared; no LAN URL).
`--public-url <url>` lets you swap in a manually-managed tunnel.

### Onboard a remote client

On the target Linux box (no glove installed yet):

```bash
GLOVE_NAME=lab1 curl -fsSL '<INSTALL_URL>' | sh
```

Downloads the server's running binary via `/bin`, starts the daemon under
`setsid + nohup`, records a pidfile, and exits. The daemon reconnects on
network blips and exits hard on auth rejection.

### Drive it from the operator side

```bash
glove list                                 # show connected clients + status
glove exec lab1 -- uname -a                # run a shell command
glove push lab1 ./local.bin /tmp/x.bin     # local → remote (md5-verified)
glove pull lab1 /tmp/x.bin ./back.bin      # remote → local (md5-verified)
```

The CLI talks to the running `glove start` over a unix socket
(`$GLOVE_STATE_DIR/control.sock`), which forwards the request to the named
client over the open wss connection.

## Conventions

- Single binary; the same `glove` executable is server, CLI, *and* client
  daemon (the daemon is the hidden `_client` subcommand).
- Token is held only in `$GLOVE_TOKEN` / `--token` — no credential is ever
  written to disk.
- Heartbeat: ping every 2s, mark offline after 5s of silence, drop after
  10s. Client reconnect uses exponential backoff capped at 15s.
- `cargo build --release` is profiled for size (`opt-level = "z"`, `lto`,
  `strip`, `panic = "abort"`, `codegen-units = 1`) — current binary ~2.3 MiB.
- Real-mode failures are *classified* (rate-limit vs tunnel-timeout vs other)
  and `glove start` refuses to silently fall back to a local URL when
  cloudflared can't mint a tunnel — the test harness asserts on this.

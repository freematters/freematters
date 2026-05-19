pub mod ctl;
pub mod http;
pub mod state;
pub mod tunnel;
pub mod ws;

use anyhow::{Context, Result};
use rand::Rng;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::UnixStream;

use crate::proto::{CtlReq, CtlResp};
use crate::state as global_state;

pub use state::ServerState;

/// `glove start` entry-point.
pub async fn run_start(
    local: bool,
    bind: String,
    port: u16,
    public_url_override: Option<String>,
) -> Result<()> {
    let token = gen_token();
    // In real mode, expand the default "127.0.0.1" bind to "0.0.0.0" so the
    // LAN install URL is actually reachable. Token-auth still gates access.
    // Users who pass an explicit non-default `--bind` are respected.
    let effective_bind = if !local && bind == "127.0.0.1" {
        "0.0.0.0".to_string()
    } else {
        bind.clone()
    };
    let listener = tokio::net::TcpListener::bind(format!("{effective_bind}:{port}"))
        .await
        .with_context(|| format!("bind {effective_bind}:{port}"))?;
    let local_addr = listener.local_addr()?;

    // Determine public URLs.
    let (http_url, ws_url) = if let Some(u) = public_url_override {
        let ws = u
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        (u, format!("{}/ws", ws))
    } else if local {
        let http = format!("http://{local_addr}");
        let ws = format!("ws://{local_addr}/ws");
        (http, ws)
    } else {
        // Real mode: cloudflared is required. Do NOT silently fall back to a
        // local URL — that masks rate-limit / network errors and confuses
        // downstream tooling.
        match tunnel::start_cloudflared(local_addr.port()).await {
            Ok(public_https) => {
                let public_ws = public_https
                    .replace("https://", "wss://")
                    .replace("http://", "ws://");
                (public_https, format!("{public_ws}/ws"))
            }
            Err(e) => {
                // Emit a single-line sentinel on stdout (first line of the
                // first error chunk) so harnesses can scrape it, then a
                // human-readable multi-line body, then propagate the error.
                let one_liner = format!("{e}").lines().next().unwrap_or("(no detail)").to_string();
                println!("TUNNEL_ERROR {one_liner}");
                eprintln!("cloudflared failed:\n{e:#}");
                return Err(anyhow::anyhow!("cloudflared failed: {e}"));
            }
        }
    };

    let state = Arc::new(ServerState::new(token.clone(), http_url.clone(), ws_url.clone()));

    // Print machine-parseable lines first.
    println!("BIND {local_addr}");
    println!("TOKEN {token}");
    println!("HTTP_URL {http_url}");
    println!("WS_URL {ws_url}");
    println!("INSTALL_URL {http_url}/install?token={token}");

    // In real mode (or any non-local bind), also surface a LAN URL so a
    // client on the same network can avoid the public tunnel hop. Uses the
    // same token — the LAN endpoint is identical to the public one.
    let lan_url = if !local {
        match primary_lan_ipv4() {
            Some(ip) => {
                let lan_http = format!("http://{ip}:{}", local_addr.port());
                println!("LAN_HTTP_URL {lan_http}");
                println!("LAN_INSTALL_URL {lan_http}/install?token={token}");
                Some(lan_http)
            }
            None => {
                eprintln!("(no non-loopback IPv4 found; skipping LAN_HTTP_URL)");
                None
            }
        }
    } else {
        None
    };

    println!();
    println!("install command (run on target Linux box):");
    println!("  curl -fsSL '{http_url}/install?token={token}' | sh");
    if let Some(lan) = &lan_url {
        println!("  # or, if the target is on the same LAN:");
        println!("  curl -fsSL '{lan}/install?token={token}' | sh");
    }

    // Write server state file (ctl needs to find the socket).
    let ctl_path = global_state::control_socket()?;
    let state_file = global_state::server_state_file()?;
    write_state_file(
        &state_file,
        std::process::id(),
        &local_addr.to_string(),
        &http_url,
        &ws_url,
        &ctl_path,
    )?;

    // Bind ctl unix socket.
    let _ = std::fs::remove_file(&ctl_path);
    let ctl_listener = tokio::net::UnixListener::bind(&ctl_path)
        .with_context(|| format!("bind ctl socket {}", ctl_path.display()))?;
    {
        let st = state.clone();
        tokio::spawn(async move {
            if let Err(e) = ctl::run(ctl_listener, st).await {
                tracing::error!("ctl listener exited: {e:#}");
            }
        });
    }

    // Serve.
    let app = http::router(state.clone());

    // Cleanup on exit.
    struct Cleanup(PathBuf, PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            let _ = std::fs::remove_file(&self.1);
        }
    }
    let _cleanup = Cleanup(ctl_path.clone(), state_file.clone());

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            tracing::info!("ctrl-c received, shutting down");
        })
        .await?;
    Ok(())
}

/// Best-effort enumeration of the primary LAN IPv4 address: opens a UDP
/// socket "connected" (no packets actually sent) to a public IP and reads
/// the local end's address — which is the IP of the interface the OS would
/// route outbound traffic through. This naturally skips loopback and
/// `docker0`-style bridges that aren't on the default route. Returns `None`
/// when no suitable IPv4 is found (e.g., IPv6-only host, no default route).
fn primary_lan_ipv4() -> Option<std::net::Ipv4Addr> {
    use std::net::{IpAddr, UdpSocket};
    // Try Cloudflare 1.1.1.1, then Google 8.8.8.8 as a fallback.
    for peer in ["1.1.1.1:80", "8.8.8.8:80"] {
        let sock = match UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(_) => continue,
        };
        // `connect` on a UDP socket only sets the default peer; no packets
        // are sent until `send`.
        if sock.connect(peer).is_err() {
            continue;
        }
        if let Ok(addr) = sock.local_addr() {
            if let IpAddr::V4(v4) = addr.ip() {
                if !v4.is_loopback() && !v4.is_unspecified() {
                    return Some(v4);
                }
            }
        }
    }
    None
}

fn gen_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill(&mut bytes);
    hex::encode(bytes)
}

fn write_state_file(
    path: &Path,
    pid: u32,
    bind: &str,
    http_url: &str,
    ws_url: &str,
    ctl_socket: &Path,
) -> Result<()> {
    let json = serde_json::json!({
        "pid": pid,
        "bind": bind,
        "http_url": http_url,
        "ws_url": ws_url,
        "ctl_socket": ctl_socket.to_string_lossy(),
    });
    std::fs::write(path, serde_json::to_vec_pretty(&json)?)?;
    Ok(())
}

// ---- CTL client (used by `glove list / exec / push / pull`) ----

async fn connect_ctl() -> Result<UnixStream> {
    let path = global_state::control_socket()?;
    UnixStream::connect(&path)
        .await
        .with_context(|| format!("connect ctl socket {}; is `glove start` running?", path.display()))
}

pub async fn ctl_list() -> Result<()> {
    let mut sock = connect_ctl().await?;
    crate::framed::write(&mut sock, crate::framed::TAG_JSON, &serde_json::to_vec(&CtlReq::List)?).await?;
    let (tag, body) = crate::framed::read(&mut sock).await?.context("ctl closed")?;
    anyhow::ensure!(tag == crate::framed::TAG_JSON, "unexpected frame tag {tag}");
    let resp: CtlResp = serde_json::from_slice(&body)?;
    match resp {
        CtlResp::List { clients } => {
            if clients.is_empty() {
                println!("(no clients)");
            } else {
                println!("{:<20} {:<10} {}", "NAME", "STATUS", "SINCE_MS");
                for c in clients {
                    println!("{:<20} {:<10} {}", c.name, c.status, c.since_ms);
                }
            }
            Ok(())
        }
        CtlResp::Error { reason } => Err(anyhow::anyhow!("server error: {reason}")),
        _ => Err(anyhow::anyhow!("unexpected response")),
    }
}

pub async fn ctl_exec(name: String, cmd: Vec<String>) -> Result<()> {
    let mut sock = connect_ctl().await?;
    crate::framed::write(
        &mut sock,
        crate::framed::TAG_JSON,
        &serde_json::to_vec(&CtlReq::Exec { name, cmd })?,
    )
    .await?;
    let (tag, body) = crate::framed::read(&mut sock).await?.context("ctl closed")?;
    anyhow::ensure!(tag == crate::framed::TAG_JSON, "unexpected frame tag {tag}");
    let resp: CtlResp = serde_json::from_slice(&body)?;
    match resp {
        CtlResp::Exec { exit_code, stdout, stderr } => {
            use tokio::io::AsyncWriteExt as _;
            let mut so = tokio::io::stdout();
            so.write_all(&stdout).await?;
            so.flush().await?;
            let mut se = tokio::io::stderr();
            se.write_all(&stderr).await?;
            se.flush().await?;
            std::process::exit(exit_code);
        }
        CtlResp::Error { reason } => Err(anyhow::anyhow!("server error: {reason}")),
        _ => Err(anyhow::anyhow!("unexpected response")),
    }
}

pub async fn ctl_push(name: String, local_path: PathBuf, remote: String) -> Result<()> {
    let bytes = tokio::fs::read(&local_path).await
        .with_context(|| format!("read {}", local_path.display()))?;
    let md5 = format!("{:x}", md5::compute(&bytes));
    let size = bytes.len() as u64;

    let mut sock = connect_ctl().await?;
    crate::framed::write(
        &mut sock,
        crate::framed::TAG_JSON,
        &serde_json::to_vec(&CtlReq::Push { name, dest: remote, size, md5: md5.clone() })?,
    )
    .await?;

    // Expect PushReady.
    let (tag, body) = crate::framed::read(&mut sock).await?.context("ctl closed")?;
    anyhow::ensure!(tag == crate::framed::TAG_JSON, "unexpected frame tag {tag}");
    let resp: CtlResp = serde_json::from_slice(&body)?;
    match resp {
        CtlResp::PushReady => {}
        CtlResp::Error { reason } => return Err(anyhow::anyhow!("push refused: {reason}")),
        _ => return Err(anyhow::anyhow!("unexpected response")),
    }

    // Stream chunks.
    let mut off = 0usize;
    while off < bytes.len() {
        let end = (off + crate::proto::CHUNK_PAYLOAD_SIZE).min(bytes.len());
        let last = end == bytes.len();
        let mut frame = Vec::with_capacity(end - off + 1);
        frame.push(if last { 1u8 } else { 0u8 });
        frame.extend_from_slice(&bytes[off..end]);
        crate::framed::write(&mut sock, crate::framed::TAG_CHUNK, &frame).await?;
        off = end;
    }
    if size == 0 {
        // empty file: still need to mark end
        let frame = vec![1u8];
        crate::framed::write(&mut sock, crate::framed::TAG_CHUNK, &frame).await?;
    }

    // Expect PushDone.
    let (tag, body) = crate::framed::read(&mut sock).await?.context("ctl closed")?;
    anyhow::ensure!(tag == crate::framed::TAG_JSON, "unexpected frame tag {tag}");
    let resp: CtlResp = serde_json::from_slice(&body)?;
    match resp {
        CtlResp::PushDone { ok: true, md5: Some(remote_md5), .. } => {
            if remote_md5 != md5 {
                return Err(anyhow::anyhow!("md5 mismatch: local={md5} remote={remote_md5}"));
            }
            println!("push ok: {size} bytes, md5={md5}");
            Ok(())
        }
        CtlResp::PushDone { ok: false, reason, .. } => {
            Err(anyhow::anyhow!("push failed: {}", reason.unwrap_or_else(|| "(no reason)".into())))
        }
        CtlResp::PushDone { ok: true, md5: None, .. } => {
            Err(anyhow::anyhow!("client did not return md5"))
        }
        CtlResp::Error { reason } => Err(anyhow::anyhow!("server error: {reason}")),
        _ => Err(anyhow::anyhow!("unexpected response")),
    }
}

pub async fn ctl_pull(name: String, remote: String, local_path: PathBuf) -> Result<()> {
    let mut sock = connect_ctl().await?;
    crate::framed::write(
        &mut sock,
        crate::framed::TAG_JSON,
        &serde_json::to_vec(&CtlReq::Pull { name, src: remote })?,
    )
    .await?;

    // Expect PullBegin
    let (tag, body) = crate::framed::read(&mut sock).await?.context("ctl closed")?;
    anyhow::ensure!(tag == crate::framed::TAG_JSON, "unexpected frame tag {tag}");
    let resp: CtlResp = serde_json::from_slice(&body)?;
    let (expected_size, expected_md5) = match resp {
        CtlResp::PullBegin { size, md5 } => (size, md5),
        CtlResp::Error { reason } => return Err(anyhow::anyhow!("pull refused: {reason}")),
        _ => return Err(anyhow::anyhow!("unexpected response")),
    };

    // Stream chunks into file.
    let mut buf = Vec::with_capacity(expected_size as usize);
    loop {
        let (tag, body) = crate::framed::read(&mut sock).await?.context("ctl closed mid-stream")?;
        if tag == crate::framed::TAG_JSON {
            // Could be PullDone (error case) or final.
            let resp: CtlResp = serde_json::from_slice(&body)?;
            match resp {
                CtlResp::PullDone { ok: false, reason } => {
                    return Err(anyhow::anyhow!("pull failed: {}", reason.unwrap_or_default()));
                }
                CtlResp::PullDone { ok: true, .. } => break,
                _ => return Err(anyhow::anyhow!("unexpected ctl frame mid-stream")),
            }
        } else if tag == crate::framed::TAG_CHUNK {
            anyhow::ensure!(!body.is_empty(), "empty chunk frame");
            let last = body[0] == 1;
            buf.extend_from_slice(&body[1..]);
            if last {
                // wait for PullDone
                let (t2, b2) = crate::framed::read(&mut sock).await?.context("ctl closed")?;
                anyhow::ensure!(t2 == crate::framed::TAG_JSON, "expected json after last chunk");
                let resp: CtlResp = serde_json::from_slice(&b2)?;
                match resp {
                    CtlResp::PullDone { ok: true, .. } => break,
                    CtlResp::PullDone { ok: false, reason } => {
                        return Err(anyhow::anyhow!("pull failed: {}", reason.unwrap_or_default()));
                    }
                    _ => return Err(anyhow::anyhow!("unexpected ctl frame after last chunk")),
                }
            }
        } else {
            anyhow::bail!("unknown frame tag {tag}");
        }
    }
    let got_md5 = format!("{:x}", md5::compute(&buf));
    if got_md5 != expected_md5 {
        return Err(anyhow::anyhow!("md5 mismatch: server={expected_md5} got={got_md5}"));
    }
    tokio::fs::write(&local_path, &buf).await
        .with_context(|| format!("write {}", local_path.display()))?;
    println!("pull ok: {} bytes, md5={got_md5}", buf.len());
    Ok(())
}


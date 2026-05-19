//! Real-mode end-to-end smoke test: drives `glove start` without `--local`,
//! exercising the full stack (cloudflared → TryCloudflare → wss → ws server).
//!
//! Covers T1 (install one-liner via real HTTPS), T2 (exec), and T3-lite
//! (small file push / pull round-trip).
//!
//! **Opt-in / `#[ignore]`-d**: this test depends on the public Internet and
//! TryCloudflare's anonymous-quick-tunnel quota (which is IP-rate-limited).
//! It is NOT run by default `cargo test`; only the LOCAL_MODE `e2e_t*` suite
//! runs by default. Invoke it manually for final verification:
//!
//! ```text
//! cargo test --test e2e_real_smoke --release -- --ignored --nocapture
//! ```
//!
//! Failure-mode policy (revised after the Session-4 misdiagnosis):
//!   * If `start_real` returns `RateLimited`, sleep ~6 minutes and retry once.
//!   * Any other failure (timeout, missing trycloudflare host, protocol
//!     error, ...) is a hard fail with a clear category in the message —
//!     we no longer silently loop and re-spawn, and we no longer DNS-poll a
//!     local-fallback URL pretending it's a trycloudflare host.
//!   * `GLOVE_SKIP_REAL=1` self-skips. Missing `cloudflared` self-skips.

mod common;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use tokio::process::Command;

use common::StartRealError;

fn locate_cloudflared() -> Option<PathBuf> {
    // 1) Workspace-local copy
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let cand = manifest.join("cloudflared");
    if cand.exists() {
        return Some(cand);
    }
    // 2) GLOVE_CLOUDFLARED env override
    if let Ok(p) = std::env::var("GLOVE_CLOUDFLARED") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    // 3) Anything on PATH
    if let Ok(out) = std::process::Command::new("sh").arg("-c").arg("command -v cloudflared").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(PathBuf::from(s));
            }
        }
    }
    None
}

/// Try once; if rate-limited, sleep `backoff` and try again. Anything else
/// (including a host that isn't `*.trycloudflare.com`) is propagated.
async fn start_with_rate_limit_retry(
    cf_dir: &std::path::Path,
    backoff: Duration,
) -> anyhow::Result<common::TestServer> {
    match common::TestServer::start_real(cf_dir).await {
        Ok(s) => return Ok(s),
        Err(StartRealError::RateLimited(msg)) => {
            eprintln!("[real-smoke] TryCloudflare rate-limited: {msg}");
            eprintln!("[real-smoke] sleeping {:?} before single retry", backoff);
            tokio::time::sleep(backoff).await;
        }
        Err(StartRealError::TunnelTimeout(msg)) => {
            anyhow::bail!("cloudflared tunnel timeout (no trycloudflare URL): {msg}");
        }
        Err(StartRealError::Other(e)) => {
            anyhow::bail!("real-mode startup failed (non-rate-limit): {e:#}");
        }
    }
    // Single retry after backoff.
    match common::TestServer::start_real(cf_dir).await {
        Ok(s) => Ok(s),
        Err(StartRealError::RateLimited(msg)) => {
            anyhow::bail!("still rate-limited after {:?} cooldown: {msg}", backoff)
        }
        Err(StartRealError::TunnelTimeout(msg)) => {
            anyhow::bail!("cloudflared tunnel timeout on retry: {msg}")
        }
        Err(StartRealError::Other(e)) => {
            anyhow::bail!("real-mode startup failed on retry (non-rate-limit): {e:#}")
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "real-mode hits TryCloudflare (rate-limited); run with --ignored for final verify"]
async fn real_smoke_install_exec_push() -> anyhow::Result<()> {
    if std::env::var("GLOVE_SKIP_REAL").is_ok() {
        eprintln!("GLOVE_SKIP_REAL set; skipping real-mode smoke");
        return Ok(());
    }
    let Some(cf) = locate_cloudflared() else {
        eprintln!("cloudflared not found in workspace, $GLOVE_CLOUDFLARED, or PATH; skipping");
        return Ok(());
    };
    let cf_dir = cf.parent().unwrap().to_path_buf();
    eprintln!("using cloudflared at {}", cf.display());

    // Start the server. We accept a single rate-limit retry with a 6-minute
    // cooldown; anything else is a hard fail with a categorized message.
    let backoff = std::env::var("GLOVE_RATE_LIMIT_BACKOFF_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(6 * 60));
    let server = start_with_rate_limit_retry(&cf_dir, backoff).await?;

    eprintln!("HTTP_URL  = {}", server.http_url);
    eprintln!("WS_URL    = {}", server.ws_url);
    eprintln!("INSTALL   = {}", server.install_url);
    // Defensive (start_real also checks this): real mode must yield a
    // trycloudflare host. If this trips it's a glove bug, not env.
    assert!(
        server.http_url.contains(".trycloudflare.com"),
        "HTTP_URL is not a trycloudflare URL (glove bug, not env): {}",
        server.http_url
    );
    assert!(
        server.ws_url.starts_with("wss://"),
        "WS_URL is not wss:// (glove bug, not env): {}",
        server.ws_url
    );

    // Wait for the tunnel to actually accept HTTPS. This catches the
    // "URL printed but tunnel teared down" failure mode (the EPIPE bug
    // we fixed in src/server/tunnel.rs). If this trips with a fresh
    // tunnel URL, it's almost always a real glove bug.
    let t0 = Instant::now();
    let mut ready = false;
    let mut last_curl_err = String::new();
    while t0.elapsed() < Duration::from_secs(45) {
        let out = Command::new("curl")
            .arg("-fsS")
            .arg("--max-time").arg("5")
            .arg(format!("{}/", server.http_url))
            .output().await?;
        if out.status.success() && String::from_utf8_lossy(&out.stdout).contains("glove server") {
            ready = true;
            break;
        }
        last_curl_err = format!(
            "exit={:?} stdout={:?} stderr={:?}",
            out.status.code(),
            String::from_utf8_lossy(&out.stdout).chars().take(160).collect::<String>(),
            String::from_utf8_lossy(&out.stderr).chars().take(160).collect::<String>(),
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert!(
        ready,
        "tunnel never returned glove server root in 45s (last curl: {last_curl_err})"
    );
    eprintln!("tunnel ready after {:?}", t0.elapsed());

    // ---- T1: install one-liner via real HTTPS ----
    let install_start = Instant::now();
    common::install_via_curl(&server, "rc1").await?;
    assert!(
        server.wait_client("rc1", "online", Duration::from_secs(30)).await,
        "client rc1 did not come online within 30s of install (glove protocol error)"
    );
    eprintln!("T1 install→online: {:?}", install_start.elapsed());

    // ---- T2: exec round-trip ----
    let t_exec = Instant::now();
    let out = server.cmd().arg("exec").arg("rc1").arg("--").arg("echo").arg("hello_real").output().await?;
    assert!(out.status.success(), "exec exit code = {:?}", out.status.code());
    assert_eq!(String::from_utf8_lossy(&out.stdout), "hello_real\n");
    eprintln!("T2 exec: {:?}", t_exec.elapsed());

    // ---- T3-lite: push + pull a small file ----
    let tmp = tempfile::tempdir()?;
    let local_in = tmp.path().join("in.bin");
    let bytes: Vec<u8> = (0..16 * 1024u32).map(|i| (i & 0xff) as u8).collect(); // 16 KiB
    std::fs::write(&local_in, &bytes)?;
    let md5_in = format!("{:x}", md5::compute(&bytes));
    let remote = tmp.path().join("out.bin");
    let out = server.cmd().arg("push").arg("rc1").arg(&local_in).arg(remote.to_string_lossy().to_string()).output().await?;
    assert!(out.status.success(), "push failed: {}", String::from_utf8_lossy(&out.stderr));
    let got = std::fs::read(&remote)?;
    assert_eq!(format!("{:x}", md5::compute(&got)), md5_in, "pushed file md5 mismatch");

    let local_back = tmp.path().join("back.bin");
    let out = server.cmd().arg("pull").arg("rc1").arg(remote.to_string_lossy().to_string()).arg(&local_back).output().await?;
    assert!(out.status.success(), "pull failed: {}", String::from_utf8_lossy(&out.stderr));
    let back = std::fs::read(&local_back)?;
    assert_eq!(format!("{:x}", md5::compute(&back)), md5_in, "pulled file md5 mismatch");
    eprintln!("T3-lite push/pull OK");

    Ok(())
}

#![allow(dead_code)]
//! Shared test harness for `glove` e2e tests.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub struct TestServer {
    pub child: Option<Child>,
    pub state_dir: tempfile::TempDir,
    pub bind: String,
    pub token: String,
    pub http_url: String,
    pub ws_url: String,
    pub install_url: String,
    /// Optional: `LAN_HTTP_URL` from server stdout (real mode only).
    pub lan_http_url: Option<String>,
    /// Optional: `LAN_INSTALL_URL` from server stdout (real mode only).
    pub lan_install_url: Option<String>,
    pub bin: PathBuf,
}

/// Distinct failure modes from `start_real` so callers can decide whether to
/// back off (rate-limit) or fail loudly.
#[derive(Debug)]
pub enum StartRealError {
    /// cloudflared reported a 429 / rate-limit before producing a URL.
    RateLimited(String),
    /// cloudflared did not return a URL within the timeout, no 429 keyword.
    TunnelTimeout(String),
    /// Anything else (bind error, IO error, ...).
    Other(anyhow::Error),
}

impl std::fmt::Display for StartRealError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StartRealError::RateLimited(s) => write!(f, "TryCloudflare rate-limited: {s}"),
            StartRealError::TunnelTimeout(s) => write!(f, "cloudflared tunnel timeout: {s}"),
            StartRealError::Other(e) => write!(f, "{e:#}"),
        }
    }
}

impl std::error::Error for StartRealError {}

impl TestServer {
    pub async fn start() -> anyhow::Result<Self> {
        Self::start_inner(true, None).await
    }

    /// Real-mode server: spawns cloudflared via `cloudflared_dir/cloudflared`.
    /// Returns a classified `StartRealError` so the caller can back off on
    /// rate-limit specifically. Hard-fails if the resulting HTTP_URL is not a
    /// `*.trycloudflare.com` host (defensive check against any future
    /// silent-fallback regression).
    pub async fn start_real(cloudflared_dir: &Path) -> Result<Self, StartRealError> {
        let server = Self::start_inner(false, Some(cloudflared_dir.to_path_buf()))
            .await
            .map_err(classify_start_error)?;
        if !server.http_url.contains(".trycloudflare.com") {
            return Err(StartRealError::Other(anyhow::anyhow!(
                "HTTP_URL is not a trycloudflare URL: {} (real mode must not fall back to local)",
                server.http_url
            )));
        }
        Ok(server)
    }

    async fn start_inner(local: bool, extra_path: Option<PathBuf>) -> anyhow::Result<Self> {
        let bin = PathBuf::from(env!("CARGO_BIN_EXE_glove"));
        let state_dir = tempfile::tempdir()?;
        let mut cmd = Command::new(&bin);
        cmd.arg("start").arg("--port").arg("0");
        if local {
            cmd.arg("--local");
        }
        cmd.env("GLOVE_STATE_DIR", state_dir.path())
            .env("RUST_LOG", std::env::var("GLOVE_LOG").unwrap_or_else(|_| "glove=info,info".into()));
        if let Some(p) = extra_path {
            let cur = std::env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{}:{}", p.display(), cur));
        }
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();

        let mut bind = None;
        let mut token = None;
        let mut http_url = None;
        let mut ws_url = None;
        let mut install_url = None;
        let mut lan_http_url: Option<String> = None;
        let mut lan_install_url: Option<String> = None;
        let mut tunnel_error: Option<String> = None;

        // Read header lines. Real-mode needs to wait for cloudflared (~10s).
        let per_line_timeout = if local { Duration::from_secs(5) } else { Duration::from_secs(45) };
        for _ in 0..30 {
            let line = match tokio::time::timeout(per_line_timeout, reader.next_line()).await
            {
                Ok(Ok(Some(l))) => l,
                Ok(Ok(None)) => break,
                Ok(Err(e)) => return Err(anyhow::anyhow!("read stdout: {e}")),
                Err(_) => return Err(anyhow::anyhow!("timeout waiting for server stdout")),
            };
            if let Some(r) = line.strip_prefix("BIND ") {
                bind = Some(r.to_string());
            } else if let Some(r) = line.strip_prefix("TOKEN ") {
                token = Some(r.to_string());
            } else if let Some(r) = line.strip_prefix("HTTP_URL ") {
                http_url = Some(r.to_string());
            } else if let Some(r) = line.strip_prefix("WS_URL ") {
                ws_url = Some(r.to_string());
            } else if let Some(r) = line.strip_prefix("INSTALL_URL ") {
                install_url = Some(r.to_string());
            } else if let Some(r) = line.strip_prefix("LAN_HTTP_URL ") {
                lan_http_url = Some(r.to_string());
            } else if let Some(r) = line.strip_prefix("LAN_INSTALL_URL ") {
                lan_install_url = Some(r.to_string());
            } else if let Some(r) = line.strip_prefix("TUNNEL_ERROR ") {
                tunnel_error = Some(r.to_string());
                break;
            }
            if bind.is_some()
                && token.is_some()
                && http_url.is_some()
                && ws_url.is_some()
                && install_url.is_some()
            {
                break;
            }
        }

        if let Some(msg) = tunnel_error {
            // Best-effort: kill the child immediately so it doesn't linger.
            let _ = child.start_kill();
            return Err(anyhow::anyhow!("TUNNEL_ERROR: {msg}"));
        }

        // Drain remaining stdout in background.
        tokio::spawn(async move {
            while let Ok(Some(_)) = reader.next_line().await {}
        });
        // Stream stderr to test output.
        let stderr = child.stderr.take().unwrap();
        tokio::spawn(async move {
            let mut r = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = r.next_line().await {
                eprintln!("[server] {l}");
            }
        });

        let bind = bind.ok_or_else(|| anyhow::anyhow!("no BIND in server stdout"))?;
        let token = token.unwrap();
        let http_url = http_url.unwrap();
        let ws_url = ws_url.unwrap();
        let install_url = install_url.unwrap();

        // Wait for ctl socket to exist (server up).
        let ctl = state_dir.path().join("control.sock");
        let start = std::time::Instant::now();
        let ctl_budget = if local { Duration::from_secs(5) } else { Duration::from_secs(15) };
        while !ctl.exists() {
            if start.elapsed() > ctl_budget {
                return Err(anyhow::anyhow!("ctl socket never appeared"));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        Ok(Self {
            child: Some(child),
            state_dir,
            bind,
            token,
            http_url,
            ws_url,
            install_url,
            lan_http_url,
            lan_install_url,
            bin,
        })
    }

    pub fn state_path(&self) -> &Path {
        self.state_dir.path()
    }

    pub fn cmd(&self) -> Command {
        let mut c = Command::new(&self.bin);
        c.env("GLOVE_STATE_DIR", self.state_dir.path());
        c.env(
            "RUST_LOG",
            std::env::var("GLOVE_LOG").unwrap_or_else(|_| "glove=info,info".into()),
        );
        c
    }

    /// Run `glove list` and return the parsed (name → status) map.
    pub async fn list(&self) -> std::collections::HashMap<String, String> {
        let out = self.cmd().arg("list").output().await.expect("glove list");
        let s = String::from_utf8_lossy(&out.stdout);
        let mut map = std::collections::HashMap::new();
        for line in s.lines() {
            if line.starts_with("NAME") || line.starts_with("(no clients)") {
                continue;
            }
            let mut parts = line.split_whitespace();
            if let (Some(n), Some(st)) = (parts.next(), parts.next()) {
                map.insert(n.to_string(), st.to_string());
            }
        }
        map
    }

    /// Wait for a named client to reach a given status (online/offline).
    pub async fn wait_client(&self, name: &str, status: &str, timeout: Duration) -> bool {
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            let m = self.list().await;
            if m.get(name).map(|s| s.as_str()) == Some(status) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        false
    }

    /// Wait for a named client to disappear from `list`.
    pub async fn wait_client_absent(&self, name: &str, timeout: Duration) -> bool {
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            let m = self.list().await;
            if !m.contains_key(name) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        false
    }
}

/// Heuristic classifier: look at the error chain string for telltale tokens.
/// Order matters — rate-limit beats timeout because a 429 can also look like
/// "timeout waiting for server stdout" if the server takes a while to print
/// `TUNNEL_ERROR`.
fn classify_start_error(e: anyhow::Error) -> StartRealError {
    let s = format!("{e:#}").to_lowercase();
    let rate_signals = [
        "429",
        "too many requests",
        "rate limit",
        "rate-limited",
        "rate limited",
        "quota",
    ];
    if rate_signals.iter().any(|k| s.contains(k)) {
        return StartRealError::RateLimited(format!("{e:#}"));
    }
    if s.contains("timeout") || s.contains("no trycloudflare url") {
        return StartRealError::TunnelTimeout(format!("{e:#}"));
    }
    StartRealError::Other(e)
}

impl Drop for TestServer {
    fn drop(&mut self) {
        // Kill any client daemons that may have written pidfiles in this state dir.
        if let Ok(entries) = std::fs::read_dir(self.state_dir.path()) {
            for e in entries.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) == Some("pid") {
                    if let Ok(s) = std::fs::read_to_string(&p) {
                        if let Ok(pid) = s.trim().parse::<i32>() {
                            let _ = std::process::Command::new("kill")
                                .arg("-TERM")
                                .arg(pid.to_string())
                                .status();
                        }
                    }
                }
            }
        }
        if let Some(mut c) = self.child.take() {
            let _ = c.start_kill();
        }
    }
}

/// Spawn a client daemon **directly** (no install script). Returns the Child
/// (kill_on_drop = true). The caller can `.id()` to get the PID, etc.
pub async fn spawn_client_direct(
    server: &TestServer,
    name: &str,
    token_override: Option<&str>,
) -> anyhow::Result<Child> {
    let mut cmd = Command::new(&server.bin);
    cmd.env("GLOVE_STATE_DIR", server.state_dir.path())
        .env("GLOVE_TOKEN", token_override.unwrap_or(&server.token))
        .env("RUST_LOG", std::env::var("GLOVE_LOG").unwrap_or_else(|_| "glove=info,info".into()))
        .arg("_client")
        .arg("--server")
        .arg(&server.ws_url)
        .arg("--name")
        .arg(name)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn()?;
    if let Some(out) = child.stdout.take() {
        let nm = name.to_string();
        tokio::spawn(async move {
            let mut r = BufReader::new(out).lines();
            while let Ok(Some(l)) = r.next_line().await {
                eprintln!("[client {nm} out] {l}");
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let nm = name.to_string();
        tokio::spawn(async move {
            let mut r = BufReader::new(err).lines();
            while let Ok(Some(l)) = r.next_line().await {
                eprintln!("[client {nm}] {l}");
            }
        });
    }
    Ok(child)
}

/// Run `curl ... | sh` to install + start a daemon. Returns once the install
/// script exits.  `name` is forwarded as `GLOVE_NAME`.
pub async fn install_via_curl(server: &TestServer, name: &str) -> anyhow::Result<()> {
    let cmd = format!("curl -fsSL '{}' | sh", server.install_url);
    let status = Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .env("GLOVE_STATE_DIR", server.state_dir.path())
        .env("GLOVE_NAME", name)
        .env("HOME", server.state_dir.path()) // belt-and-suspenders
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;
    let stdout = String::from_utf8_lossy(&status.stdout);
    let stderr = String::from_utf8_lossy(&status.stderr);
    eprintln!("[install {name} stdout] {stdout}");
    eprintln!("[install {name} stderr] {stderr}");
    if !status.status.success() {
        return Err(anyhow::anyhow!(
            "install script failed: exit={:?}",
            status.status
        ));
    }
    Ok(())
}

/// Read the pid recorded by the install script for a named client.
pub fn read_pidfile(server: &TestServer, name: &str) -> Option<i32> {
    let p = server.state_dir.path().join(format!("client-{name}.pid"));
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok())
}

/// Send a signal (SIGSTOP/SIGCONT/SIGTERM) to a pid via `/bin/kill`.
pub fn signal(pid: i32, sig: &str) -> bool {
    std::process::Command::new("kill")
        .arg(format!("-{sig}"))
        .arg(pid.to_string())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

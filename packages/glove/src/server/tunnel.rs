//! `cloudflared tunnel --url http://127.0.0.1:port` wrapper.
//!
//! Spawns the binary, reads its stderr, and parses out the
//! `https://<random>.trycloudflare.com` URL.

use anyhow::{anyhow, Result};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Maximum number of recent cloudflared stderr/stdout lines to retain for
/// inclusion in error messages (helps distinguish rate-limit from other
/// failure modes).
const RING_LINES: usize = 24;

pub async fn start_cloudflared(local_port: u16) -> Result<String> {
    let mut child = Command::new("cloudflared")
        .arg("tunnel")
        .arg("--no-autoupdate")
        .arg("--url")
        .arg(format!("http://127.0.0.1:{local_port}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| anyhow!("spawn cloudflared: {e}"))?;

    let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr"))?;
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;

    let mut lines1 = BufReader::new(stderr).lines();
    let mut lines2 = BufReader::new(stdout).lines();

    // Ring buffer of recent log lines so failure messages can quote them.
    let ring: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::with_capacity(RING_LINES)));

    let scanner_ring = ring.clone();
    let scanner = async {
        loop {
            tokio::select! {
                v = lines1.next_line() => match v? {
                    Some(l) => {
                        push_ring(&scanner_ring, &l);
                        tracing::debug!("cloudflared: {l}");
                        if let Some(u) = parse_url(&l) { return Ok::<String, anyhow::Error>(u); }
                    }
                    None => return Err(anyhow!("cloudflared stderr closed without url")),
                },
                v = lines2.next_line() => match v? {
                    Some(l) => {
                        push_ring(&scanner_ring, &l);
                        tracing::debug!("cloudflared(out): {l}");
                        if let Some(u) = parse_url(&l) { return Ok(u); }
                    }
                    None => {}
                }
            }
        }
    };

    let url = match tokio::time::timeout(Duration::from_secs(30), scanner).await {
        Ok(Ok(u)) => u,
        Ok(Err(e)) => {
            let tail = format_ring(&ring);
            let head = summarize(&tail).unwrap_or_else(|| e.to_string());
            return Err(anyhow!("{head}\ncloudflared log tail:\n{tail}"));
        }
        Err(_) => {
            let tail = format_ring(&ring);
            let head = summarize(&tail)
                .unwrap_or_else(|| "cloudflared timeout (no trycloudflare URL within 30s)".to_string());
            return Err(anyhow!("{head}\ncloudflared log tail:\n{tail}"));
        }
    };

    // Keep pipes open by draining stderr/stdout in background; otherwise
    // dropping the readers closes the pipes and cloudflared dies on EPIPE,
    // tearing down the tunnel right after we hand the URL back.
    tokio::spawn(async move {
        while let Ok(Some(l)) = lines1.next_line().await {
            tracing::debug!("cloudflared: {l}");
        }
    });
    tokio::spawn(async move {
        while let Ok(Some(_)) = lines2.next_line().await {}
    });

    // Detach: keep the child alive for the program lifetime.
    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(url)
}

fn push_ring(ring: &Arc<Mutex<Vec<String>>>, line: &str) {
    if let Ok(mut g) = ring.lock() {
        if g.len() == RING_LINES {
            g.remove(0);
        }
        g.push(line.to_string());
    }
}

/// Look at recent log lines and return a single-line summary classifying the
/// failure (so callers — including the test harness — can detect rate-limit
/// without parsing the multi-line log tail). Returns `None` when no known
/// signal is found.
fn summarize(tail: &str) -> Option<String> {
    let low = tail.to_lowercase();
    if low.contains("429")
        || low.contains("too many requests")
        || low.contains("rate limit")
        || low.contains("rate-limited")
    {
        return Some("cloudflared rate-limited (429 Too Many Requests) by trycloudflare.com".to_string());
    }
    if low.contains("error code: 1015") {
        return Some("cloudflared rate-limited (Cloudflare error 1015)".to_string());
    }
    if low.contains("connection refused") || low.contains("no route to host") {
        return Some("cloudflared network error (refused/no-route)".to_string());
    }
    None
}

fn format_ring(ring: &Arc<Mutex<Vec<String>>>) -> String {
    match ring.lock() {
        Ok(g) => g.join("\n"),
        Err(_) => String::from("(ring lock poisoned)"),
    }
}

fn parse_url(line: &str) -> Option<String> {
    // Look for "https://" then take until whitespace or '|' etc.
    let idx = line.find("https://")?;
    let rest = &line[idx..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '|' || c == '"' || c == '\'')
        .unwrap_or(rest.len());
    let url = &rest[..end];
    if url.contains(".trycloudflare.com") {
        Some(url.to_string())
    } else {
        None
    }
}

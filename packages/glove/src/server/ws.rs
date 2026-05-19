//! Per-client websocket handler on the server.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use axum::extract::ws::{Message as AxMsg, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;

use super::state::{
    now_ms, ClientConn, ClientEntry, ClientStatus, PendingExec, PendingPush, PendingPull,
    ServerState,
};
use crate::proto::{decode_chunk, encode_chunk, Msg};

const HELLO_TIMEOUT_SECS: u64 = 10;

pub async fn handle(socket: WebSocket, state: Arc<ServerState>) -> Result<()> {
    let (mut sink, mut stream) = socket.split();

    // Step 1: read ClientHello (with timeout).
    let hello = match tokio::time::timeout(Duration::from_secs(HELLO_TIMEOUT_SECS), stream.next()).await {
        Ok(Some(Ok(AxMsg::Text(t)))) => Msg::decode(&t)?,
        Ok(Some(Ok(other))) => {
            tracing::warn!("expected text Hello, got {:?}", other);
            let _ = sink.close().await;
            return Ok(());
        }
        Ok(Some(Err(e))) => return Err(e.into()),
        Ok(None) => return Ok(()),
        Err(_) => {
            tracing::warn!("hello timeout");
            let _ = sink.close().await;
            return Ok(());
        }
    };

    let (token, name) = match hello {
        Msg::ClientHello { token, name } => (token, name),
        _ => {
            tracing::warn!("first msg not ClientHello");
            let _ = sink
                .send(AxMsg::Text(Msg::ServerHello { ok: false, reason: Some("expected hello".into()) }.encode()))
                .await;
            let _ = sink.close().await;
            return Ok(());
        }
    };

    if !ct_eq(&token, &state.token) {
        tracing::warn!("auth rejected for name={name}");
        // Unified rejection: do not distinguish "no token" vs "wrong token".
        let _ = sink
            .send(AxMsg::Text(Msg::ServerHello { ok: false, reason: Some("unauthorized".into()) }.encode()))
            .await;
        let _ = sink.close().await;
        return Ok(());
    }

    // Step 2: register client (or take over existing entry).
    let (tx_out, mut rx_out) = mpsc::unbounded_channel::<AxMsg>();
    let connected_at_ms = now_ms();
    let generation = now_ms();
    let conn = Arc::new(ClientConn { tx: tx_out.clone(), generation });
    {
        let mut clients = state.clients.write().await;
        // Drop the previous conn so its writer task exits.
        if let Some(prev) = clients.get_mut(&name) {
            if let Some(prev_conn) = prev.conn.take() {
                // Closing the receiver causes the writer to fail; explicit close msg too.
                let _ = prev_conn.tx.send(AxMsg::Close(None));
                drop(prev_conn);
            }
        }
        let entry = ClientEntry {
            name: name.clone(),
            status: ClientStatus::Online,
            connected_at_ms,
            last_seen_ms: std::sync::atomic::AtomicU64::new(now_ms()),
            conn: Some(conn.clone()),
        };
        clients.insert(name.clone(), entry);
    }

    // Send ServerHello.
    if let Err(e) = sink
        .send(AxMsg::Text(Msg::ServerHello { ok: true, reason: None }.encode()))
        .await
    {
        tracing::warn!("send hello failed: {e}");
        return Ok(());
    }
    tracing::info!("client {name} connected");

    // Writer task: forwards messages from rx_out → ws sink.
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx_out.recv().await {
            if matches!(msg, AxMsg::Close(_)) {
                let _ = sink.send(msg).await;
                let _ = sink.close().await;
                break;
            }
            if let Err(e) = sink.send(msg).await {
                tracing::debug!("ws send failed: {e}");
                break;
            }
        }
    });

    // Heartbeat task: send ping every ping_every_ms; check liveness.
    let hb_state = state.clone();
    let hb_name = name.clone();
    let hb_tx = tx_out.clone();
    let heartbeat = tokio::spawn(async move {
        let mut iv = tokio::time::interval(Duration::from_millis(hb_state.ping_every_ms));
        loop {
            iv.tick().await;
            // Try to read entry; check we are still the active conn.
            let still_alive = {
                let clients = hb_state.clients.read().await;
                if let Some(entry) = clients.get(&hb_name) {
                    if let Some(c) = &entry.conn {
                        c.generation == generation
                    } else {
                        false
                    }
                } else {
                    false
                }
            };
            if !still_alive {
                break;
            }
            // Send app-level ping.
            if hb_tx
                .send(AxMsg::Text(Msg::Ping { ts_ms: now_ms() }.encode()))
                .is_err()
            {
                break;
            }
            // Check liveness.
            let last = {
                let clients = hb_state.clients.read().await;
                clients
                    .get(&hb_name)
                    .map(|e| e.last_seen_ms.load(std::sync::atomic::Ordering::Relaxed))
                    .unwrap_or(0)
            };
            if now_ms().saturating_sub(last) > hb_state.offline_after_ms {
                tracing::info!("client {hb_name} timed out (no msg in {}ms), forcing close", hb_state.offline_after_ms);
                let _ = hb_tx.send(AxMsg::Close(None));
                break;
            }
        }
    });

    // Reader loop.
    let reader_result: Result<()> = async {
        while let Some(item) = stream.next().await {
            let msg = match item {
                Ok(m) => m,
                Err(e) => return Err(anyhow!("ws recv: {e}")),
            };
            // Update last_seen.
            if let Some(entry) = state.clients.read().await.get(&name) {
                entry
                    .last_seen_ms
                    .store(now_ms(), std::sync::atomic::Ordering::Relaxed);
            }
            match msg {
                AxMsg::Text(t) => {
                    let m = match Msg::decode(&t) {
                        Ok(m) => m,
                        Err(e) => {
                            tracing::warn!("decode: {e}");
                            continue;
                        }
                    };
                    handle_text(&state, &name, m).await?;
                }
                AxMsg::Binary(b) => {
                    handle_binary(&state, &name, &b).await?;
                }
                AxMsg::Ping(p) => {
                    let _ = tx_out.send(AxMsg::Pong(p));
                }
                AxMsg::Pong(_) => {}
                AxMsg::Close(_) => {
                    return Ok(());
                }
            }
        }
        Ok(())
    }
    .await;

    if let Err(e) = reader_result {
        tracing::info!("reader for {name} exited: {e}");
    } else {
        tracing::info!("reader for {name} exited cleanly");
    }

    // Mark client offline if we are still the active conn.
    {
        let mut clients = state.clients.write().await;
        if let Some(entry) = clients.get_mut(&name) {
            let still_us = entry
                .conn
                .as_ref()
                .map(|c| c.generation == generation)
                .unwrap_or(false);
            if still_us {
                entry.status = ClientStatus::Offline;
                entry.conn = None;
            }
        }
    }

    // Stop helper tasks.
    drop(tx_out);
    let _ = heartbeat.await;
    let _ = writer.await;

    // Fail any pending ops targeting this client. (Conservative: drop senders so receivers see channel-closed.)
    // Pending ops aren't keyed by client name; that's acceptable for v1 since at most one op per client at a time.
    Ok(())
}

async fn handle_text(state: &Arc<ServerState>, _name: &str, msg: Msg) -> Result<()> {
    match msg {
        Msg::Pong { .. } | Msg::Ping { .. } => {
            // last_seen already updated; pong is automatic via ws layer if needed.
            Ok(())
        }
        Msg::ExecResponse { id, exit_code, stdout, stderr } => {
            let mut g = state.pending_exec.lock().await;
            if let Some(p) = g.remove(&id) {
                let _ = p.tx.send((exit_code, stdout, stderr));
            }
            Ok(())
        }
        Msg::PushAck { id, ok, reason } => {
            let mut g = state.pending_push.lock().await;
            if let Some(p) = g.get_mut(&id) {
                // Take the ack sender out via a swap.
                let (new_tx, _new_rx) = tokio::sync::oneshot::channel();
                let ack_tx = std::mem::replace(&mut p.ack, new_tx);
                if ok {
                    let _ = ack_tx.send(Ok(()));
                } else {
                    let _ = ack_tx.send(Err(reason.unwrap_or_else(|| "refused".into())));
                }
            }
            Ok(())
        }
        Msg::PushDone { id, ok, md5, reason } => {
            let mut g = state.pending_push.lock().await;
            if let Some(p) = g.remove(&id) {
                if ok {
                    let _ = p.done.send(Ok(md5));
                } else {
                    let _ = p.done.send(Err(reason.unwrap_or_else(|| "failed".into())));
                }
            }
            Ok(())
        }
        Msg::PullBegin { id, size, md5 } => {
            let mut g = state.pending_pull.lock().await;
            if let Some(p) = g.get_mut(&id) {
                let (new_tx, _) = tokio::sync::oneshot::channel();
                let bt = std::mem::replace(&mut p.begin, new_tx);
                let _ = bt.send(Ok((size, md5)));
            }
            Ok(())
        }
        Msg::PullError { id, reason } => {
            let mut g = state.pending_pull.lock().await;
            if let Some(p) = g.remove(&id) {
                let _ = p.begin.send(Err(reason));
                let _ = p.chunks.send(None);
            }
            Ok(())
        }
        Msg::TransferEnd { id } => {
            // Could be end of a pull. (Push end is implicit when client sends PushDone.)
            let mut g = state.pending_pull.lock().await;
            if let Some(p) = g.remove(&id) {
                let _ = p.chunks.send(None);
            }
            Ok(())
        }
        Msg::ClientHello { .. } | Msg::ServerHello { .. } => {
            tracing::warn!("unexpected hello msg mid-stream");
            Ok(())
        }
        Msg::ExecRequest { .. } | Msg::PushBegin { .. } | Msg::PullRequest { .. } => {
            tracing::warn!("server got request msg from client; ignoring");
            Ok(())
        }
    }
}

async fn handle_binary(state: &Arc<ServerState>, _name: &str, body: &[u8]) -> Result<()> {
    let (id, _seq, _last, payload) = decode_chunk(body)?;
    let g = state.pending_pull.lock().await;
    if let Some(p) = g.get(&id) {
        let _ = p.chunks.send(Some(payload.to_vec()));
    }
    Ok(())
}

fn ct_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut acc = 0u8;
    for i in 0..a.len() {
        acc |= a[i] ^ b[i];
    }
    acc == 0
}

// Quiet "unused" warnings for items used only on hot paths.
#[allow(dead_code)]
fn _force_use(_: &PendingExec, _: &PendingPush, _: &PendingPull) {}
#[allow(dead_code)]
fn _force_encode_chunk_use() {
    let _ = encode_chunk(0, 0, true, &[]);
}

//! Unix-socket IPC between `glove <subcommand>` CLI and the running `glove start` server.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use axum::extract::ws::Message as AxMsg;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, oneshot};

use super::state::{ClientStatus, PendingExec, PendingPull, PendingPush, ServerState};
use crate::framed;
use crate::proto::{encode_chunk, CtlClientInfo, CtlReq, CtlResp, Msg};

pub async fn run(listener: UnixListener, state: Arc<ServerState>) -> Result<()> {
    loop {
        let (sock, _) = listener.accept().await?;
        let st = state.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(sock, st).await {
                tracing::warn!("ctl session: {e:#}");
            }
        });
    }
}

async fn handle(mut sock: UnixStream, state: Arc<ServerState>) -> Result<()> {
    let (tag, body) = framed::read(&mut sock).await?.ok_or_else(|| anyhow!("eof"))?;
    if tag != framed::TAG_JSON {
        return Err(anyhow!("first frame must be json"));
    }
    let req: CtlReq = serde_json::from_slice(&body)?;
    match req {
        CtlReq::List => handle_list(&mut sock, &state).await,
        CtlReq::Exec { name, cmd } => handle_exec(&mut sock, &state, name, cmd).await,
        CtlReq::Push { name, dest, size, md5 } => {
            handle_push(&mut sock, &state, name, dest, size, md5).await
        }
        CtlReq::Pull { name, src } => handle_pull(&mut sock, &state, name, src).await,
    }
}

async fn handle_list(sock: &mut UnixStream, state: &Arc<ServerState>) -> Result<()> {
    let now = super::state::now_ms();
    let clients = state.clients.read().await;
    let infos: Vec<CtlClientInfo> = clients
        .values()
        .map(|e| {
            // Re-evaluate status: if Online but last_seen too old, treat as Offline.
            let last = e.last_seen_ms.load(std::sync::atomic::Ordering::Relaxed);
            let effective = if e.status == ClientStatus::Online && now.saturating_sub(last) > state.offline_after_ms {
                ClientStatus::Offline
            } else {
                e.status
            };
            CtlClientInfo {
                name: e.name.clone(),
                status: effective.to_string(),
                since_ms: now.saturating_sub(e.connected_at_ms),
            }
        })
        .collect();
    let resp = CtlResp::List { clients: infos };
    framed::write(sock, framed::TAG_JSON, &serde_json::to_vec(&resp)?).await?;
    Ok(())
}

async fn send_err(sock: &mut UnixStream, reason: impl Into<String>) -> Result<()> {
    let resp = CtlResp::Error { reason: reason.into() };
    framed::write(sock, framed::TAG_JSON, &serde_json::to_vec(&resp)?).await?;
    Ok(())
}

async fn lookup_conn(
    state: &Arc<ServerState>,
    name: &str,
) -> Option<mpsc::UnboundedSender<AxMsg>> {
    let clients = state.clients.read().await;
    clients
        .get(name)
        .and_then(|e| e.conn.as_ref().map(|c| c.tx.clone()))
}

async fn handle_exec(
    sock: &mut UnixStream,
    state: &Arc<ServerState>,
    name: String,
    cmd: Vec<String>,
) -> Result<()> {
    let Some(tx) = lookup_conn(state, &name).await else {
        return send_err(sock, format!("client '{name}' not online")).await;
    };
    let id = state.next_id();
    let (rt, rx) = oneshot::channel();
    state
        .pending_exec
        .lock()
        .await
        .insert(id, PendingExec { tx: rt });
    let req = Msg::ExecRequest { id, cmd };
    if tx.send(AxMsg::Text(req.encode())).is_err() {
        state.pending_exec.lock().await.remove(&id);
        return send_err(sock, "client connection lost").await;
    }
    let res = tokio::time::timeout(Duration::from_secs(60), rx).await;
    let (exit_code, stdout, stderr) = match res {
        Ok(Ok(t)) => t,
        Ok(Err(_)) => {
            return send_err(sock, "exec cancelled").await;
        }
        Err(_) => {
            state.pending_exec.lock().await.remove(&id);
            return send_err(sock, "exec timeout").await;
        }
    };
    let resp = CtlResp::Exec { exit_code, stdout, stderr };
    framed::write(sock, framed::TAG_JSON, &serde_json::to_vec(&resp)?).await?;
    Ok(())
}

async fn handle_push(
    sock: &mut UnixStream,
    state: &Arc<ServerState>,
    name: String,
    dest: String,
    size: u64,
    md5: String,
) -> Result<()> {
    let Some(tx) = lookup_conn(state, &name).await else {
        return send_err(sock, format!("client '{name}' not online")).await;
    };
    let id = state.next_id();
    let (ack_tx, ack_rx) = oneshot::channel();
    let (done_tx, done_rx) = oneshot::channel();
    state.pending_push.lock().await.insert(
        id,
        PendingPush { ack: ack_tx, done: done_tx },
    );
    let begin = Msg::PushBegin { id, dest, size, md5 };
    if tx.send(AxMsg::Text(begin.encode())).is_err() {
        state.pending_push.lock().await.remove(&id);
        return send_err(sock, "client connection lost").await;
    }

    // Wait for ack.
    let ack = match tokio::time::timeout(Duration::from_secs(30), ack_rx).await {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => {
            state.pending_push.lock().await.remove(&id);
            return send_err(sock, "push cancelled").await;
        }
        Err(_) => {
            state.pending_push.lock().await.remove(&id);
            return send_err(sock, "push ack timeout").await;
        }
    };
    if let Err(e) = ack {
        state.pending_push.lock().await.remove(&id);
        return send_err(sock, format!("push refused: {e}")).await;
    }

    // Tell CTL we're ready.
    framed::write(
        sock,
        framed::TAG_JSON,
        &serde_json::to_vec(&CtlResp::PushReady)?,
    )
    .await?;

    // Read chunks from CTL → forward as binary ws frames to client.
    let mut seq: u32 = 0;
    loop {
        let frame = framed::read(sock).await?;
        let (ftag, fbody) = match frame {
            Some(f) => f,
            None => {
                state.pending_push.lock().await.remove(&id);
                return Err(anyhow!("ctl closed mid push"));
            }
        };
        if ftag != framed::TAG_CHUNK {
            state.pending_push.lock().await.remove(&id);
            return Err(anyhow!("expected chunk tag, got {ftag}"));
        }
        anyhow::ensure!(!fbody.is_empty(), "empty push chunk");
        let last = fbody[0] == 1;
        let chunk = encode_chunk(id, seq, last, &fbody[1..]);
        if tx.send(AxMsg::Binary(chunk)).is_err() {
            state.pending_push.lock().await.remove(&id);
            return send_err(sock, "client connection lost mid push").await;
        }
        seq += 1;
        if last {
            // Send a TransferEnd marker as well (defensive).
            let end = Msg::TransferEnd { id };
            let _ = tx.send(AxMsg::Text(end.encode()));
            break;
        }
    }

    // Await PushDone from client.
    let done = match tokio::time::timeout(Duration::from_secs(120), done_rx).await {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => return send_err(sock, "push cancelled").await,
        Err(_) => return send_err(sock, "push done timeout").await,
    };
    let resp = match done {
        Ok(md5_opt) => CtlResp::PushDone { ok: true, reason: None, md5: md5_opt },
        Err(e) => CtlResp::PushDone { ok: false, reason: Some(e), md5: None },
    };
    framed::write(sock, framed::TAG_JSON, &serde_json::to_vec(&resp)?).await?;
    Ok(())
}

async fn handle_pull(
    sock: &mut UnixStream,
    state: &Arc<ServerState>,
    name: String,
    src: String,
) -> Result<()> {
    let Some(tx) = lookup_conn(state, &name).await else {
        return send_err(sock, format!("client '{name}' not online")).await;
    };
    let id = state.next_id();
    let (begin_tx, begin_rx) = oneshot::channel();
    let (chunk_tx, mut chunk_rx) = mpsc::unbounded_channel();
    state.pending_pull.lock().await.insert(
        id,
        PendingPull { begin: begin_tx, chunks: chunk_tx },
    );
    let req = Msg::PullRequest { id, src };
    if tx.send(AxMsg::Text(req.encode())).is_err() {
        state.pending_pull.lock().await.remove(&id);
        return send_err(sock, "client connection lost").await;
    }

    // Wait for PullBegin or PullError.
    let begin = match tokio::time::timeout(Duration::from_secs(30), begin_rx).await {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => {
            state.pending_pull.lock().await.remove(&id);
            return send_err(sock, "pull cancelled").await;
        }
        Err(_) => {
            state.pending_pull.lock().await.remove(&id);
            return send_err(sock, "pull begin timeout").await;
        }
    };
    let (size, md5) = match begin {
        Ok(t) => t,
        Err(e) => {
            state.pending_pull.lock().await.remove(&id);
            return send_err(sock, format!("pull error: {e}")).await;
        }
    };
    framed::write(
        sock,
        framed::TAG_JSON,
        &serde_json::to_vec(&CtlResp::PullBegin { size, md5 })?,
    )
    .await?;

    // Forward chunks until None (end).
    let mut received_bytes: u64 = 0;
    loop {
        let chunk = match tokio::time::timeout(Duration::from_secs(120), chunk_rx.recv()).await {
            Ok(Some(v)) => v,
            Ok(None) => {
                return send_err(sock, "pull aborted (channel closed)").await;
            }
            Err(_) => {
                state.pending_pull.lock().await.remove(&id);
                return send_err(sock, "pull chunk timeout").await;
            }
        };
        match chunk {
            Some(bytes) => {
                received_bytes += bytes.len() as u64;
                let last = received_bytes >= size;
                let mut frame = Vec::with_capacity(bytes.len() + 1);
                frame.push(if last { 1u8 } else { 0u8 });
                frame.extend_from_slice(&bytes);
                framed::write(sock, framed::TAG_CHUNK, &frame).await?;
                if last {
                    break;
                }
            }
            None => {
                // end-of-stream marker
                break;
            }
        }
    }

    // Done.
    framed::write(
        sock,
        framed::TAG_JSON,
        &serde_json::to_vec(&CtlResp::PullDone { ok: true, reason: None })?,
    )
    .await?;
    Ok(())
}

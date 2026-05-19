//! Client daemon: connects to the server over wss, handles ExecRequest /
//! PushBegin / PullRequest. Reconnects with exponential backoff.

pub mod exec;
pub mod files;

use std::time::Duration;

use anyhow::{anyhow, Result};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as TgMsg;

use crate::proto::{decode_chunk, Msg};

#[derive(Debug)]
enum ConnError {
    /// Server explicitly rejected our hello (bad token / unknown name).
    /// Treated as fatal — do not retry.
    Auth(String),
    Other(anyhow::Error),
}

impl From<anyhow::Error> for ConnError {
    fn from(e: anyhow::Error) -> Self {
        ConnError::Other(e)
    }
}

pub async fn run(server_url: String, name: String, token: String) -> Result<()> {
    let mut backoff_ms: u64 = 500;
    loop {
        match connect_and_serve(&server_url, &name, &token).await {
            Ok(()) => {
                tracing::info!("connection closed; reconnecting");
                backoff_ms = 500;
            }
            Err(ConnError::Auth(reason)) => {
                tracing::error!("server rejected auth: {reason}");
                eprintln!("glove client: server rejected: {reason}");
                std::process::exit(2);
            }
            Err(ConnError::Other(e)) => {
                tracing::warn!("connection failed: {e:#}");
            }
        }
        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        backoff_ms = (backoff_ms * 2).min(15_000);
    }
}

async fn connect_and_serve(server_url: &str, name: &str, token: &str) -> Result<(), ConnError> {
    tracing::info!("connecting to {server_url}");
    let (ws_stream, _resp) = tokio_tungstenite::connect_async(server_url)
        .await
        .map_err(|e| ConnError::Other(anyhow!("connect: {e}")))?;
    let (mut sink, mut stream) = ws_stream.split();

    // Send hello.
    let hello = Msg::ClientHello {
        token: token.to_string(),
        name: name.to_string(),
    };
    sink.send(TgMsg::Text(hello.encode()))
        .await
        .map_err(|e| ConnError::Other(anyhow!("send hello: {e}")))?;

    // Read ServerHello.
    let server_hello = match tokio::time::timeout(Duration::from_secs(10), stream.next()).await {
        Ok(Some(Ok(TgMsg::Text(t)))) => Msg::decode(&t).map_err(ConnError::Other)?,
        Ok(Some(Ok(other))) => return Err(ConnError::Other(anyhow!("expected text hello, got {other:?}"))),
        Ok(Some(Err(e))) => return Err(ConnError::Other(anyhow!("recv hello: {e}"))),
        Ok(None) => return Err(ConnError::Other(anyhow!("server closed during hello"))),
        Err(_) => return Err(ConnError::Other(anyhow!("server hello timeout"))),
    };
    match server_hello {
        Msg::ServerHello { ok: true, .. } => {}
        Msg::ServerHello { ok: false, reason } => {
            return Err(ConnError::Auth(reason.unwrap_or_else(|| "rejected".into())));
        }
        other => return Err(ConnError::Other(anyhow!("unexpected first msg: {other:?}"))),
    }
    tracing::info!("authenticated as '{name}'");

    // Spawn writer task with a channel.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<TgMsg>();
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            if matches!(m, TgMsg::Close(_)) {
                let _ = sink.send(m).await;
                let _ = sink.close().await;
                break;
            }
            if let Err(e) = sink.send(m).await {
                tracing::debug!("client send failed: {e}");
                break;
            }
        }
    });

    // State for in-flight file transfers.
    let mut active_push: Option<files::PushReceiver> = None;
    // We do not currently buffer multiple pulls; single in-flight pull at a time on this conn is OK.

    while let Some(item) = stream.next().await {
        let msg = match item {
            Ok(m) => m,
            Err(e) => {
                tracing::info!("ws recv err: {e}");
                break;
            }
        };
        match msg {
            TgMsg::Text(t) => {
                let m = match Msg::decode(&t) {
                    Ok(m) => m,
                    Err(e) => {
                        tracing::warn!("decode: {e}");
                        continue;
                    }
                };
                handle_text(m, &out_tx, &mut active_push).await;
            }
            TgMsg::Binary(b) => {
                if let Some(p) = active_push.as_mut() {
                    if let Err(e) = p.feed(&b).await {
                        tracing::warn!("push feed: {e}");
                        let _ = out_tx.send(TgMsg::Text(
                            Msg::PushDone {
                                id: p.id,
                                ok: false,
                                md5: None,
                                reason: Some(e.to_string()),
                            }
                            .encode(),
                        ));
                        active_push = None;
                        continue;
                    }
                    if p.is_done() {
                        let (ok, md5, reason) = p.finalize().await;
                        let _ = out_tx.send(TgMsg::Text(
                            Msg::PushDone { id: p.id, ok, md5, reason }.encode(),
                        ));
                        active_push = None;
                    }
                } else {
                    tracing::warn!("got binary chunk with no active push");
                    let _ = decode_chunk(&b);
                }
            }
            TgMsg::Ping(p) => {
                let _ = out_tx.send(TgMsg::Pong(p));
            }
            TgMsg::Pong(_) => {}
            TgMsg::Close(_) => {
                tracing::info!("server sent close");
                break;
            }
            TgMsg::Frame(_) => {}
        }
    }

    drop(out_tx);
    let _ = writer.await;
    Ok(())
}

async fn handle_text(
    msg: Msg,
    out_tx: &mpsc::UnboundedSender<TgMsg>,
    active_push: &mut Option<files::PushReceiver>,
) {
    match msg {
        Msg::Ping { ts_ms } => {
            let _ = out_tx.send(TgMsg::Text(Msg::Pong { ts_ms }.encode()));
        }
        Msg::Pong { .. } => {}
        Msg::ExecRequest { id, cmd } => {
            let tx = out_tx.clone();
            tokio::spawn(async move {
                let (exit_code, stdout, stderr) = exec::run(cmd).await;
                let _ = tx.send(TgMsg::Text(
                    Msg::ExecResponse { id, exit_code, stdout, stderr }.encode(),
                ));
            });
        }
        Msg::PushBegin { id, dest, size, md5 } => {
            match files::PushReceiver::open(id, dest.clone(), size, md5.clone()).await {
                Ok(p) => {
                    *active_push = Some(p);
                    let _ = out_tx.send(TgMsg::Text(
                        Msg::PushAck { id, ok: true, reason: None }.encode(),
                    ));
                }
                Err(e) => {
                    let _ = out_tx.send(TgMsg::Text(
                        Msg::PushAck {
                            id,
                            ok: false,
                            reason: Some(e.to_string()),
                        }
                        .encode(),
                    ));
                }
            }
        }
        Msg::PullRequest { id, src } => {
            let tx = out_tx.clone();
            tokio::spawn(async move {
                files::handle_pull(id, src, tx).await;
            });
        }
        Msg::TransferEnd { .. } => {
            // Push end-of-stream marker; handled implicitly via "last" chunk flag.
        }
        Msg::ServerHello { .. } | Msg::ClientHello { .. } => {}
        Msg::ExecResponse { .. } | Msg::PushAck { .. } | Msg::PushDone { .. }
        | Msg::PullBegin { .. } | Msg::PullError { .. } => {
            tracing::warn!("client got server-only msg, ignoring");
        }
    }
}

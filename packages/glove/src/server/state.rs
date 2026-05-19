use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::ws::Message as AxMsg;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientStatus {
    Online,
    Offline,
}

impl std::fmt::Display for ClientStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ClientStatus::Online => "online",
            ClientStatus::Offline => "offline",
        })
    }
}

pub struct ClientEntry {
    pub name: String,
    pub status: ClientStatus,
    pub connected_at_ms: u64,
    pub last_seen_ms: AtomicU64,
    pub conn: Option<Arc<ClientConn>>,
}

pub struct ClientConn {
    pub tx: mpsc::UnboundedSender<AxMsg>,
    /// Set to true when a fatal/duplicate-name takeover has decided to drop us.
    /// The writer task reads this on exit; reader task signals via dropping tx.
    pub generation: u64,
}

pub struct PendingExec {
    pub tx: oneshot::Sender<(i32, Vec<u8>, Vec<u8>)>,
}

pub struct PendingPush {
    /// Fired when the client returns PushAck.
    pub ack: oneshot::Sender<Result<(), String>>,
    /// Fired when the client returns PushDone.
    pub done: oneshot::Sender<Result<Option<String>, String>>,
}

pub struct PendingPull {
    /// Fired when the client returns PullBegin (Ok) or PullError (Err).
    pub begin: oneshot::Sender<Result<(u64, String), String>>,
    /// Each binary chunk forwarded by the client.
    /// `None` signals end-of-stream (TransferEnd).
    pub chunks: mpsc::UnboundedSender<Option<Vec<u8>>>,
}

pub struct ServerState {
    pub token: String,
    pub http_url: String,
    pub ws_url: String,
    pub clients: RwLock<HashMap<String, ClientEntry>>,
    pub pending_exec: Mutex<HashMap<u64, PendingExec>>,
    pub pending_push: Mutex<HashMap<u64, PendingPush>>,
    pub pending_pull: Mutex<HashMap<u64, PendingPull>>,
    pub next_id: AtomicU64,
    /// Mark a client offline if no message received within this many ms.
    pub offline_after_ms: u64,
    pub ping_every_ms: u64,
}

impl ServerState {
    pub fn new(token: String, http_url: String, ws_url: String) -> Self {
        Self {
            token,
            http_url,
            ws_url,
            clients: RwLock::new(HashMap::new()),
            pending_exec: Mutex::new(HashMap::new()),
            pending_push: Mutex::new(HashMap::new()),
            pending_pull: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            offline_after_ms: 5_000,
            ping_every_ms: 2_000,
        }
    }

    pub fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }
}

pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

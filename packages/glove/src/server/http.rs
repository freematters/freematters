use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message as AxMsg, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;

use super::ServerState;

pub fn router(state: Arc<ServerState>) -> Router {
    Router::new()
        .route("/", get(root))
        .route("/install", get(install))
        .route("/bin", get(bin))
        .route("/ws", get(ws_upgrade))
        .with_state(state)
}

async fn root() -> &'static str {
    "glove server\n"
}

#[derive(Deserialize)]
pub struct InstallQuery {
    pub token: String,
    pub name: Option<String>,
}

async fn install(
    State(state): State<Arc<ServerState>>,
    Query(q): Query<InstallQuery>,
) -> Response {
    // Constant-time-ish compare. Token validity gate: the install script
    // *embeds* the token in the daemon CLI it spawns. Letting wrong tokens
    // download the script is harmless (script will still be rejected at ws),
    // but we still gate to reduce noise.
    if !ct_eq(&q.token, &state.token) {
        return (StatusCode::FORBIDDEN, "forbidden\n").into_response();
    }
    let script = crate::install::render(&state.http_url, &state.ws_url, &q.token, q.name.as_deref());
    (
        [(header::CONTENT_TYPE, "text/x-shellscript")],
        script,
    )
        .into_response()
}

async fn bin() -> Response {
    let path = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("no current_exe: {e}")).into_response(),
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            [(header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        )
            .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("read {}: {e}", path.display()))
            .into_response(),
    }
}

async fn ws_upgrade(
    State(state): State<Arc<ServerState>>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<ServerState>) {
    if let Err(e) = super::ws::handle(socket, state).await {
        tracing::warn!("ws handler exited: {e:#}");
    }
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

#[allow(dead_code)]
fn _force_use_axmsg(_: AxMsg) {}

//! Wire protocol shared by server and client.
//!
//! All control messages are JSON over ws **text** frames.
//! File chunks travel as ws **binary** frames with a 13-byte header.

use serde::{Deserialize, Serialize};

/// Control message envelope. `kind` discriminates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Msg {
    /// First message client sends after connecting.
    ClientHello { token: String, name: String },
    /// Server response to hello.
    ServerHello { ok: bool, reason: Option<String> },
    /// Application-level heartbeat.
    Ping { ts_ms: u64 },
    Pong { ts_ms: u64 },

    /// Server → client: run a shell command. cmd[0] is program, cmd[1..] are args.
    ExecRequest { id: u64, cmd: Vec<String> },
    /// Client → server: result of an exec.
    ExecResponse {
        id: u64,
        exit_code: i32,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    },

    /// Server → client: about to push N bytes to `dest`, with `md5`.
    PushBegin {
        id: u64,
        dest: String,
        size: u64,
        md5: String,
    },
    /// Client → server: push accepted/refused.
    PushAck {
        id: u64,
        ok: bool,
        reason: Option<String>,
    },
    /// Client → server: push complete on client side, with md5.
    PushDone {
        id: u64,
        ok: bool,
        md5: Option<String>,
        reason: Option<String>,
    },

    /// Server → client: request a file from client.
    PullRequest { id: u64, src: String },
    /// Client → server: about to send N bytes back, with md5.
    PullBegin {
        id: u64,
        size: u64,
        md5: String,
    },
    /// Client → server: error reading src.
    PullError { id: u64, reason: String },
    /// Either side: transfer done (sender → receiver).
    TransferEnd { id: u64 },
}

impl Msg {
    pub fn encode(&self) -> String {
        serde_json::to_string(self).expect("serialize Msg")
    }
    pub fn decode(s: &str) -> anyhow::Result<Msg> {
        Ok(serde_json::from_str(s)?)
    }
}

/// Binary chunk header (13 bytes).
///   - u64 LE transfer_id
///   - u32 LE seq
///   - u8 flags  (bit0 = last)
pub const CHUNK_HEADER_LEN: usize = 13;
pub const FLAG_LAST: u8 = 0x01;

pub fn encode_chunk(transfer_id: u64, seq: u32, last: bool, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(CHUNK_HEADER_LEN + payload.len());
    v.extend_from_slice(&transfer_id.to_le_bytes());
    v.extend_from_slice(&seq.to_le_bytes());
    v.push(if last { FLAG_LAST } else { 0 });
    v.extend_from_slice(payload);
    v
}

pub fn decode_chunk(buf: &[u8]) -> anyhow::Result<(u64, u32, bool, &[u8])> {
    if buf.len() < CHUNK_HEADER_LEN {
        anyhow::bail!("chunk too short: {} bytes", buf.len());
    }
    let mut id_bytes = [0u8; 8];
    id_bytes.copy_from_slice(&buf[0..8]);
    let id = u64::from_le_bytes(id_bytes);
    let mut seq_bytes = [0u8; 4];
    seq_bytes.copy_from_slice(&buf[8..12]);
    let seq = u32::from_le_bytes(seq_bytes);
    let flags = buf[12];
    let last = (flags & FLAG_LAST) != 0;
    Ok((id, seq, last, &buf[CHUNK_HEADER_LEN..]))
}

pub const CHUNK_PAYLOAD_SIZE: usize = 64 * 1024;

/// Control message envelope sent over the unix-socket IPC between CLI and the
/// running server process.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CtlReq {
    List,
    Exec { name: String, cmd: Vec<String> },
    Push { name: String, dest: String, size: u64, md5: String },
    Pull { name: String, src: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CtlResp {
    Error { reason: String },
    List { clients: Vec<CtlClientInfo> },
    Exec { exit_code: i32, stdout: Vec<u8>, stderr: Vec<u8> },
    /// Tells the CLI we are ready to receive chunks.
    PushReady,
    /// After we got the bytes from the CLI and forwarded to the client.
    PushDone { ok: bool, reason: Option<String>, md5: Option<String> },
    /// Tells the CLI the file size and md5 to expect on the wire.
    PullBegin { size: u64, md5: String },
    /// After the bytes have been streamed back to the CLI.
    PullDone { ok: bool, reason: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CtlClientInfo {
    pub name: String,
    pub status: String, // "online" | "offline"
    pub since_ms: u64,
}

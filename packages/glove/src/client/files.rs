//! File transfer on the client side.
//!
//! * Push (server → client): receive `PushBegin`, open the file, ack, then
//!   absorb binary chunks until the `last` flag is set, then return
//!   `PushDone` with the locally-computed md5.
//! * Pull (client → server): open the requested file, reply with
//!   `PullBegin`, stream binary chunks, then `TransferEnd`.

use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use md5::Context as Md5Context;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as TgMsg;

use crate::proto::{decode_chunk, encode_chunk, Msg, CHUNK_PAYLOAD_SIZE};

pub struct PushReceiver {
    pub id: u64,
    dest: PathBuf,
    expected_size: u64,
    expected_md5: String,
    file: std::fs::File,
    md5: Md5Context,
    written: u64,
    done: bool,
}

impl PushReceiver {
    pub async fn open(id: u64, dest: String, size: u64, md5: String) -> Result<Self> {
        let dest_path = PathBuf::from(&dest);
        if let Some(parent) = dest_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).ok();
            }
        }
        let file = std::fs::File::create(&dest_path)
            .with_context(|| format!("create {}", dest_path.display()))?;
        Ok(Self {
            id,
            dest: dest_path,
            expected_size: size,
            expected_md5: md5,
            file,
            md5: Md5Context::new(),
            written: 0,
            done: false,
        })
    }

    pub async fn feed(&mut self, frame: &[u8]) -> Result<()> {
        let (xfer_id, _seq, last, payload) = decode_chunk(frame)?;
        if xfer_id != self.id {
            return Err(anyhow!(
                "transfer id mismatch: expected {} got {}",
                self.id,
                xfer_id
            ));
        }
        self.file.write_all(payload)?;
        self.md5.consume(payload);
        self.written += payload.len() as u64;
        if last {
            self.done = true;
        }
        Ok(())
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    pub async fn finalize(&mut self) -> (bool, Option<String>, Option<String>) {
        if self.written != self.expected_size {
            return (
                false,
                None,
                Some(format!(
                    "size mismatch: expected {} got {}",
                    self.expected_size, self.written
                )),
            );
        }
        let got = format!("{:x}", self.md5.clone().compute());
        if got != self.expected_md5 {
            return (
                false,
                Some(got.clone()),
                Some(format!(
                    "md5 mismatch: expected {} got {}",
                    self.expected_md5, got
                )),
            );
        }
        let _ = self.file.flush();
        // Sanity: file is on-disk now.
        let _ = std::fs::metadata(&self.dest);
        (true, Some(got), None)
    }
}

pub async fn handle_pull(id: u64, src: String, tx: mpsc::UnboundedSender<TgMsg>) {
    let path = Path::new(&src);
    let bytes = match tokio::fs::read(path).await {
        Ok(b) => b,
        Err(e) => {
            let _ = tx.send(TgMsg::Text(
                Msg::PullError {
                    id,
                    reason: format!("read {}: {e}", path.display()),
                }
                .encode(),
            ));
            return;
        }
    };
    let md5 = format!("{:x}", md5::compute(&bytes));
    let size = bytes.len() as u64;
    let _ = tx.send(TgMsg::Text(
        Msg::PullBegin { id, size, md5 }.encode(),
    ));
    let mut seq: u32 = 0;
    let mut off = 0usize;
    while off < bytes.len() {
        let end = (off + CHUNK_PAYLOAD_SIZE).min(bytes.len());
        let last = end == bytes.len();
        let chunk = encode_chunk(id, seq, last, &bytes[off..end]);
        if tx.send(TgMsg::Binary(chunk)).is_err() {
            return;
        }
        seq += 1;
        off = end;
    }
    if size == 0 {
        let chunk = encode_chunk(id, 0, true, &[]);
        let _ = tx.send(TgMsg::Binary(chunk));
    }
    let _ = tx.send(TgMsg::Text(Msg::TransferEnd { id }.encode()));
}

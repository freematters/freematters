//! Tiny length-prefixed framing used on the CTL unix socket.
//!
//! Wire format per frame:
//!   - u32 LE  payload length (including the tag byte)
//!   - u8      tag (`TAG_JSON` or `TAG_CHUNK`)
//!   - bytes   payload

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const TAG_JSON: u8 = 0;
pub const TAG_CHUNK: u8 = 1;

pub async fn read<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<Option<(u8, Vec<u8>)>> {
    let mut len_buf = [0u8; 4];
    if let Err(e) = r.read_exact(&mut len_buf).await {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            return Ok(None);
        }
        return Err(e);
    }
    let total = u32::from_le_bytes(len_buf) as usize;
    if total == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "zero-length frame",
        ));
    }
    let mut buf = vec![0u8; total];
    r.read_exact(&mut buf).await?;
    let tag = buf[0];
    buf.remove(0);
    Ok(Some((tag, buf)))
}

pub async fn write<W: AsyncWrite + Unpin>(w: &mut W, tag: u8, payload: &[u8]) -> std::io::Result<()> {
    let total = (payload.len() + 1) as u32;
    w.write_all(&total.to_le_bytes()).await?;
    w.write_all(&[tag]).await?;
    w.write_all(payload).await?;
    w.flush().await?;
    Ok(())
}

use anyhow::{Context, Result};
use std::path::PathBuf;

pub fn state_dir() -> Result<PathBuf> {
    if let Ok(v) = std::env::var("GLOVE_STATE_DIR") {
        let p = PathBuf::from(v);
        std::fs::create_dir_all(&p).with_context(|| format!("mkdir -p {}", p.display()))?;
        return Ok(p);
    }
    let base = if let Ok(v) = std::env::var("XDG_CACHE_HOME") {
        PathBuf::from(v)
    } else if let Ok(v) = std::env::var("HOME") {
        PathBuf::from(v).join(".cache")
    } else {
        PathBuf::from("/tmp")
    };
    let dir = base.join("glove");
    std::fs::create_dir_all(&dir).with_context(|| format!("mkdir -p {}", dir.display()))?;
    Ok(dir)
}

pub fn control_socket() -> Result<PathBuf> {
    Ok(state_dir()?.join("control.sock"))
}

pub fn server_state_file() -> Result<PathBuf> {
    Ok(state_dir()?.join("server.json"))
}


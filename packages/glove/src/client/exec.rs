//! Shell execution on the client side. Runs the requested command and returns
//! stdout/stderr/exit_code.

use std::process::Stdio;
use tokio::process::Command;

/// Run a command. cmd[0] is the program, cmd[1..] are args.
/// Returns `(exit_code, stdout, stderr)`.
pub async fn run(cmd: Vec<String>) -> (i32, Vec<u8>, Vec<u8>) {
    if cmd.is_empty() {
        return (127, Vec::new(), b"empty command\n".to_vec());
    }
    let mut c = Command::new(&cmd[0]);
    c.args(&cmd[1..]);
    c.stdin(Stdio::null());
    c.stdout(Stdio::piped());
    c.stderr(Stdio::piped());
    match c.output().await {
        Ok(out) => {
            let code = out.status.code().unwrap_or(-1);
            (code, out.stdout, out.stderr)
        }
        Err(e) => (127, Vec::new(), format!("spawn failed: {e}\n").into_bytes()),
    }
}

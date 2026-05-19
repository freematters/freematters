mod common;

use std::time::{Duration, Instant};

#[tokio::test(flavor = "multi_thread")]
async fn t2_exec_basic_roundtrip() -> anyhow::Result<()> {
    let server = common::TestServer::start().await?;
    let _client = common::spawn_client_direct(&server, "c1", None).await?;
    assert!(server.wait_client("c1", "online", Duration::from_secs(10)).await);

    // 1) `echo hello`
    let t = Instant::now();
    let out = server.cmd().arg("exec").arg("c1").arg("--")
        .arg("echo").arg("hello").output().await?;
    let dur = t.elapsed();
    assert!(out.status.success(), "exit code = {:?}", out.status.code());
    assert_eq!(String::from_utf8_lossy(&out.stdout), "hello\n");
    assert!(out.stderr.is_empty(), "stderr = {:?}", String::from_utf8_lossy(&out.stderr));
    assert!(dur < Duration::from_millis(500), "round-trip too slow: {dur:?}");

    // 2) `sh -c 'echo err >&2; exit 7'`
    let out = server.cmd().arg("exec").arg("c1").arg("--")
        .arg("sh").arg("-c").arg("echo err >&2; exit 7").output().await?;
    assert_eq!(out.status.code(), Some(7), "want exit 7, got {:?}", out.status.code());
    let se = String::from_utf8_lossy(&out.stderr);
    assert!(se.contains("err"), "stderr did not contain 'err': {se:?}");
    Ok(())
}

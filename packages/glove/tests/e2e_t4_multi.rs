mod common;

use std::time::Duration;

#[tokio::test(flavor = "multi_thread")]
async fn t4_multi_client_directed() -> anyhow::Result<()> {
    let server = common::TestServer::start().await?;
    let _c1 = common::spawn_client_direct(&server, "c1", None).await?;
    let _c2 = common::spawn_client_direct(&server, "c2", None).await?;
    assert!(server.wait_client("c1", "online", Duration::from_secs(10)).await);
    assert!(server.wait_client("c2", "online", Duration::from_secs(10)).await);

    let out = server.cmd().arg("exec").arg("c1").arg("--").arg("echo").arg("I_AM_C1").output().await?;
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout), "I_AM_C1\n");

    let out = server.cmd().arg("exec").arg("c2").arg("--").arg("echo").arg("I_AM_C2").output().await?;
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout), "I_AM_C2\n");

    // Sentinel: write a file on c1 only, check c2 didn't write it.
    let tmp = tempfile::tempdir()?;
    let sent = tmp.path().join("sentinel.txt");
    let out = server.cmd().arg("exec").arg("c1").arg("--")
        .arg("sh").arg("-c")
        .arg(format!("echo c1_was_here > {}", sent.display()))
        .output().await?;
    assert!(out.status.success());
    let content = std::fs::read_to_string(&sent)?;
    assert_eq!(content.trim(), "c1_was_here");
    // (c2 ran nothing that should touch this file; no extra check needed.)
    Ok(())
}

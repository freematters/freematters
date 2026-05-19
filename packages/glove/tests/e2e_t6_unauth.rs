mod common;

use std::time::Duration;

#[tokio::test(flavor = "multi_thread")]
async fn t6_unauthorized_rejected() -> anyhow::Result<()> {
    let server = common::TestServer::start().await?;
    let bad_token = "deadbeefcafebabe".repeat(4); // same length as a hex token
    let mut child = common::spawn_client_direct(&server, "evil", Some(&bad_token)).await?;
    // Client should self-exit (auth is fatal, exit code 2).
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait()).await
        .map_err(|_| anyhow::anyhow!("client did not exit after bad-token rejection"))??;
    assert!(!status.success(), "expected non-success exit, got {status:?}");
    assert_eq!(status.code(), Some(2), "expected exit code 2, got {:?}", status.code());

    // List should not show "evil".
    let map = server.list().await;
    assert!(!map.contains_key("evil"), "evil should not be in client list: {map:?}");
    Ok(())
}

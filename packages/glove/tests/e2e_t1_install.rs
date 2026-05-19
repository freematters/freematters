mod common;

use std::time::{Duration, Instant};

#[tokio::test(flavor = "multi_thread")]
async fn t1_install_one_liner() -> anyhow::Result<()> {
    let server = common::TestServer::start().await?;
    // Skip if curl is missing.
    if std::process::Command::new("sh").arg("-c").arg("command -v curl").status().map(|s| !s.success()).unwrap_or(true) {
        eprintln!("curl not available, skipping T1");
        return Ok(());
    }
    let start = Instant::now();
    common::install_via_curl(&server, "c1").await?;
    assert!(server.wait_client("c1", "online", Duration::from_secs(30)).await,
            "client did not come online within 30s");
    assert!(start.elapsed() < Duration::from_secs(30),
            "elapsed {:?} > 30s", start.elapsed());
    Ok(())
}

mod common;

use std::time::{Duration, Instant};

#[tokio::test(flavor = "multi_thread")]
async fn t5_reconnect_after_drop() -> anyhow::Result<()> {
    let server = common::TestServer::start().await?;
    let client = common::spawn_client_direct(&server, "c1", None).await?;
    assert!(server.wait_client("c1", "online", Duration::from_secs(10)).await);
    let pid = client.id().expect("client pid") as i32;

    // Simulate network drop: pause the client process so it stops reading/sending.
    assert!(common::signal(pid, "STOP"), "SIGSTOP failed");

    // Expect server marks offline within offline_after_ms (5s) + grace.
    let t_drop = Instant::now();
    assert!(server.wait_client("c1", "offline", Duration::from_secs(8)).await,
            "client did not go offline within 8s");
    eprintln!("offline detected after {:?}", t_drop.elapsed());

    // Now resume and expect online within 10s.
    assert!(common::signal(pid, "CONT"), "SIGCONT failed");
    let t_resume = Instant::now();
    assert!(server.wait_client("c1", "online", Duration::from_secs(15)).await,
            "client did not come back online within 15s");
    eprintln!("back online after {:?}", t_resume.elapsed());

    // And exec works.
    let out = server.cmd().arg("exec").arg("c1").arg("--").arg("echo").arg("back").output().await?;
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout), "back\n");
    Ok(())
}

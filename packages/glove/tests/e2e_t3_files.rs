mod common;

use rand::RngCore;
use std::time::Duration;

#[tokio::test(flavor = "multi_thread")]
async fn t3_file_bidirectional() -> anyhow::Result<()> {
    let server = common::TestServer::start().await?;
    let _client = common::spawn_client_direct(&server, "c1", None).await?;
    assert!(server.wait_client("c1", "online", Duration::from_secs(10)).await);

    let tmp = tempfile::tempdir()?;
    let a_path = tmp.path().join("A.bin");
    let mut a_bytes = vec![0u8; 1 << 20]; // 1 MiB
    rand::thread_rng().fill_bytes(&mut a_bytes);
    std::fs::write(&a_path, &a_bytes)?;
    let a_md5 = format!("{:x}", md5::compute(&a_bytes));

    let remote_a = tmp.path().join("A_remote.bin");

    // push
    let out = server.cmd().arg("push").arg("c1").arg(&a_path).arg(remote_a.to_string_lossy().to_string()).output().await?;
    assert!(out.status.success(), "push failed: stderr={}", String::from_utf8_lossy(&out.stderr));
    let got_a = std::fs::read(&remote_a)?;
    assert_eq!(format!("{:x}", md5::compute(&got_a)), a_md5);

    // Create file B on client side via exec (dd from /dev/urandom)
    let b_remote = tmp.path().join("B_remote.bin");
    let out = server.cmd().arg("exec").arg("c1").arg("--")
        .arg("sh").arg("-c")
        .arg(format!("dd if=/dev/urandom of={} bs=1024 count=1024 status=none && md5sum {} | awk '{{print $1}}'", b_remote.display(), b_remote.display()))
        .output().await?;
    assert!(out.status.success(), "dd failed: {}", String::from_utf8_lossy(&out.stderr));
    let b_md5 = String::from_utf8_lossy(&out.stdout).trim().to_string();
    assert_eq!(b_md5.len(), 32, "expected 32-char md5, got {b_md5:?}");

    // pull
    let b_local = tmp.path().join("B_local.bin");
    let out = server.cmd().arg("pull").arg("c1").arg(b_remote.to_string_lossy().to_string()).arg(&b_local).output().await?;
    assert!(out.status.success(), "pull failed: stderr={}", String::from_utf8_lossy(&out.stderr));
    let got_b = std::fs::read(&b_local)?;
    assert_eq!(format!("{:x}", md5::compute(&got_b)), b_md5);
    Ok(())
}

// Self-update. The server publishes a newer Tuno.exe with a checksum and an ECDSA signature made with a private key that
// only lives on the developer's PC; the matching public key is built into this exe. A download is used only if the
// checksum, the signature and the version inside the file all check out, so a hacked server or a stranger on the network
// can't make Tuno run their code. The file is installed when Tuno is idle or closed (Windows lets a running exe be
// renamed, so the swap needs no helper program). The files and checks are the same as the earlier C# app's, so either
// version can update to the other.
use std::{
    fs,
    io::Read,
    path::PathBuf,
    process::Command,
    time::{Duration, SystemTime},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use sha2::{Digest, Sha256};

use super::sys;
use crate::common::{home, origin, Version};

const MAX_SIZE: u64 = 64 * 1024 * 1024;
/// The public half of the update signing key, as a Windows CNG "ECS1" blob (base64). See windows/new-signing-key.ps1.
const PUBLIC_KEY: &str = include_str!("../../../windows/update-public.key");

fn dir() -> PathBuf {
    home().join("update")
}
fn pending_exe() -> PathBuf {
    dir().join("pending.exe")
}
fn pending_info() -> PathBuf {
    dir().join("pending.txt")
}

pub fn exe_path() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("Tuno.exe"))
}

fn agent() -> ureq::Agent {
    let tls = native_tls::TlsConnector::new().map(std::sync::Arc::new);
    let mut builder = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(30));
    if let Ok(tls) = tls {
        builder = builder.tls_connector(tls);
    }
    builder.user_agent(&format!("Tuno-Windows/{}", Version::current())).build()
}

pub struct CheckResult {
    /// The version now ready to install, if any.
    pub ready: Option<Version>,
    pub message: String,
    /// True when the server answered (even "you're up to date"): the next check can wait the full six hours.
    pub answered: bool,
}

/// Asks the server for the latest build and downloads it if it's newer.
pub fn check_and_download(server: &str) -> CheckResult {
    let result = check(server);
    let line = format!("{:?}  {}\r\n", SystemTime::now(), result.message);
    let _ = fs::create_dir_all(home());
    let _ = fs::OpenOptions::new().create(true).append(true).open(home().join("update.log")).and_then(|mut f| {
        use std::io::Write;
        f.write_all(line.as_bytes())
    });
    result
}

fn check(server: &str) -> CheckResult {
    let fail = |message: String| CheckResult { ready: None, message, answered: false };
    let Some(base) = origin(server) else { return fail("Couldn't check for updates: the server address is invalid".into()) };
    let agent = agent();
    let info: serde_json::Value = match agent.get(&format!("{base}/api/app/latest?platform=windows")).call() {
        Ok(r) => match r.into_json() {
            Ok(v) => v,
            Err(e) => return fail(format!("Couldn't check for updates: {e}")),
        },
        Err(ureq::Error::Status(404, _)) => {
            return CheckResult { ready: None, message: "Your server has no Windows update published.".into(), answered: true }
        }
        Err(e) => return fail(format!("Couldn't check for updates: {e}")),
    };
    let current = Version::current();
    let Some(latest) = info["version"].as_str().and_then(Version::parse) else {
        return fail("Couldn't check for updates: the server's answer is invalid".into());
    };
    if latest <= current {
        return CheckResult { ready: None, message: format!("Tuno {current} is the latest version."), answered: true };
    }
    if let Some(ready) = pending_version() {
        if ready >= latest {
            return CheckResult { ready: Some(ready), message: format!("Tuno {ready} is ready to install."), answered: true };
        }
    }
    match download(&agent, &base, latest, &info) {
        Ok(()) => CheckResult { ready: Some(latest), message: format!("Tuno {latest} has been downloaded."), answered: true },
        Err(e) => {
            let _ = fs::remove_file(part_path());
            fail(format!("Couldn't check for updates: {e}"))
        }
    }
}

fn part_path() -> PathBuf {
    dir().join("pending.exe.part")
}

fn download(agent: &ureq::Agent, base: &str, latest: Version, info: &serde_json::Value) -> Result<(), String> {
    let sha = info["sha256"].as_str().unwrap_or("").to_ascii_lowercase();
    let signature = info["signature"].as_str().unwrap_or("").to_string();
    let size = info["size"].as_u64().unwrap_or(0);
    if size == 0 || size > MAX_SIZE || signature.is_empty() {
        return Err("the update's details are invalid".into());
    }
    fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let response = agent.get(&format!("{base}/api/app/download/windows")).call().map_err(|e| e.to_string())?;
    let mut data = Vec::with_capacity(size as usize);
    response.into_reader().take(size + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() as u64 > size {
        return Err("the download is larger than announced".into());
    }
    if data.len() as u64 != size {
        return Err("the download is incomplete".into());
    }
    if hex(&Sha256::digest(&data)) != sha {
        return Err("the download is corrupt (checksum mismatch)".into());
    }
    if !verify_signature(&data, &signature) {
        return Err("the update isn't signed with your Tuno key, so it was ignored".into());
    }
    let part = part_path();
    fs::write(&part, &data).map_err(|e| e.to_string())?;
    if sys::file_version(&part) != Some(latest) {
        return Err("the file isn't the version it claims to be".into());
    }
    let _ = fs::remove_file(pending_exe());
    fs::rename(&part, pending_exe()).map_err(|e| e.to_string())?;
    fs::write(pending_info(), format!("version={latest}\r\nsignature={signature}\r\n")).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_info(key: &str) -> Option<String> {
    let text = fs::read_to_string(pending_info()).ok()?;
    text.lines().find_map(|l| l.strip_prefix(&format!("{key}=")).map(|v| v.trim().to_string()))
}

/// The version of a downloaded, verified update waiting to be installed.
pub fn pending_version() -> Option<Version> {
    if !pending_exe().exists() {
        return None;
    }
    read_info("version").and_then(|v| Version::parse(&v))
}

/// Checks the downloaded file once more and puts it in place of the running exe. Returns false if there's nothing
/// (valid) to install, or Tuno sits in a folder it can't write to: then it just keeps running this version.
pub fn try_apply_pending() -> bool {
    let Some(v) = pending_version() else { return false };
    if v <= Version::current() {
        return false;
    }
    let Ok(data) = fs::read(pending_exe()) else { return false };
    let signature = read_info("signature").unwrap_or_default();
    if !verify_signature(&data, &signature) || sys::file_version(&pending_exe()) != Some(v) {
        let _ = fs::remove_file(pending_exe());
        return false;
    }
    let exe = exe_path();
    let old = old_path();
    let _ = fs::remove_file(&old);
    if fs::rename(&exe, &old).is_err() {
        return false;
    }
    if fs::rename(pending_exe(), &exe).is_err() {
        let _ = fs::rename(&old, &exe);
        return false;
    }
    let _ = fs::remove_file(pending_info());
    true
}

fn old_path() -> PathBuf {
    let mut p = exe_path().into_os_string();
    p.push(".old");
    PathBuf::from(p)
}

/// Starts the (new) exe. It waits for this one to close before taking over (see --after-update).
pub fn restart() -> bool {
    Command::new(exe_path()).arg("--after-update").spawn().is_ok()
}

pub fn clean_up_old_version() {
    let _ = fs::remove_file(old_path());
}

fn verify_signature(data: &[u8], signature_b64: &str) -> bool {
    let Ok(blob) = B64.decode(PUBLIC_KEY.trim()) else { return false };
    // BCRYPT_ECCKEY_BLOB: "ECS1", key length (32), then X and Y.
    if blob.len() != 8 + 64 || &blob[0..4] != b"ECS1" {
        return false;
    }
    let mut point = Vec::with_capacity(65);
    point.push(0x04);
    point.extend_from_slice(&blob[8..]);
    let Ok(key) = VerifyingKey::from_sec1_bytes(&point) else { return false };
    let Ok(sig_bytes) = B64.decode(signature_b64.trim()) else { return false };
    // Windows signs in IEEE P1363 form: r and s, 32 bytes each.
    let Ok(sig) = Signature::from_slice(&sig_bytes) else { return false };
    key.verify(data, &sig).is_ok()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn public_key_parses() {
        use base64::Engine;
        let blob = super::B64.decode(super::PUBLIC_KEY.trim()).unwrap();
        assert_eq!(&blob[0..4], b"ECS1");
        let mut point = vec![4u8];
        point.extend_from_slice(&blob[8..]);
        assert!(super::VerifyingKey::from_sec1_bytes(&point).is_ok());
    }

    /// A real published update must verify, and a changed copy must not. Point TUNO_TEST_EXE at a Tuno.exe from the
    /// feed and TUNO_TEST_SIG at its signature (the feed's "signature" field); skipped when they aren't set.
    #[test]
    fn real_update_verifies() {
        let (Ok(exe), Ok(sig)) = (std::env::var("TUNO_TEST_EXE"), std::env::var("TUNO_TEST_SIG")) else { return };
        let mut data = std::fs::read(exe).unwrap();
        assert!(super::verify_signature(&data, &sig), "the published update should verify");
        let last = data.len() - 1;
        data[last] ^= 1;
        assert!(!super::verify_signature(&data, &sig), "a changed file must not verify");
    }
}

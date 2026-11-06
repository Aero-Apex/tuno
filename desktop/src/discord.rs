// Shows what Tuno is playing on the user's Discord profile ("Listening to Tuno"), the way Spotify does.
// It talks to the Discord desktop app over Discord's local pipe (Windows) or socket (macOS), with the app's Client ID.
// No token or secret is needed, and nothing is sent anywhere except to the Discord app already running on this computer.
// Frames are [opcode u32 LE][length u32 LE][JSON].
use std::{
    io::{Read, Write},
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

const CLIENT_ID: &str = "1561445740109234301";

trait Pipe: Read + Write + Send {}
impl<T: Read + Write + Send> Pipe for T {}

/// Discord work runs on its own thread, one piece at a time, so a slow Discord can't stall the window.
pub struct Discord {
    tx: Sender<Option<Value>>,
}

impl Discord {
    pub fn new() -> Discord {
        let (tx, rx) = mpsc::channel();
        thread::Builder::new()
            .name("discord".into())
            .spawn(move || worker(rx))
            .expect("discord thread");
        Discord { tx }
    }

    /// "Listening to Tuno" with the track and a progress bar. Quietly does nothing when Discord isn't running.
    pub fn show(&self, title: &str, artist: &str, position: f64, duration: f64) {
        let mut activity = json!({ "type": 2, "details": fit(title, "Tuno"), "instance": false });
        if !artist.is_empty() {
            activity["state"] = json!(fit(&format!("by {artist}"), "by Tuno"));
        }
        if duration > 0.0 {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
            let start = now - position.max(0.0) as i64;
            activity["timestamps"] = json!({ "start": start, "end": start + duration as i64 });
        }
        let _ = self.tx.send(Some(activity));
    }

    /// Removes the status.
    pub fn clear(&self) {
        let _ = self.tx.send(None);
    }
}

fn worker(rx: Receiver<Option<Value>>) {
    let mut pipe: Option<Box<dyn Pipe>> = None;
    let mut retry_after = Instant::now();
    let mut shown = false;
    while let Ok(mut activity) = rx.recv() {
        // Only the newest update matters when several queued up.
        while let Ok(newer) = rx.try_recv() {
            activity = newer;
        }
        if activity.is_none() && !shown {
            continue;
        }
        if pipe.is_none() {
            if Instant::now() < retry_after {
                continue;
            }
            pipe = connect();
            if pipe.is_none() {
                // Discord isn't running. Look again in fifteen seconds, not on every track change.
                retry_after = Instant::now() + Duration::from_secs(15);
                continue;
            }
        }
        let frame = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": format!("{:?}", Instant::now()),
        });
        let p = pipe.as_mut().unwrap();
        // Discord answers every command; the answer itself isn't needed.
        if write_frame(p, 1, &frame).and_then(|_| read_frame(p)).is_ok() {
            shown = activity.is_some();
        } else {
            pipe = None;
            shown = false;
        }
    }
}

fn connect() -> Option<Box<dyn Pipe>> {
    for candidate in candidates() {
        if let Some(mut p) = open(&candidate) {
            let hello = json!({ "v": 1, "client_id": CLIENT_ID });
            if write_frame(&mut p, 0, &hello).and_then(|_| read_frame(&mut p)).is_ok() {
                return Some(p); // READY
            }
        }
    }
    None
}

#[cfg(windows)]
fn candidates() -> Vec<String> {
    (0..10).map(|i| format!(r"\\.\pipe\discord-ipc-{i}")).collect()
}

#[cfg(windows)]
fn open(path: &str) -> Option<Box<dyn Pipe>> {
    std::fs::OpenOptions::new().read(true).write(true).open(path).ok().map(|f| Box::new(f) as Box<dyn Pipe>)
}

#[cfg(unix)]
fn candidates() -> Vec<String> {
    let mut folders: Vec<String> =
        ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"].iter().filter_map(|k| std::env::var(k).ok()).collect();
    folders.push("/tmp".into());
    folders
        .iter()
        .flat_map(|f| (0..10).map(move |i| format!("{}/discord-ipc-{i}", f.trim_end_matches('/'))))
        .collect()
}

#[cfg(unix)]
fn open(path: &str) -> Option<Box<dyn Pipe>> {
    let s = std::os::unix::net::UnixStream::connect(path).ok()?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(2)));
    Some(Box::new(s))
}

fn write_frame(p: &mut Box<dyn Pipe>, op: u32, payload: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(payload)?;
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    p.write_all(&buf)?;
    p.flush()
}

fn read_frame(p: &mut Box<dyn Pipe>) -> std::io::Result<()> {
    let mut head = [0u8; 8];
    p.read_exact(&mut head)?;
    let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
    if len > 1 << 20 {
        return Err(std::io::Error::other("Discord sent an odd reply"));
    }
    let mut body = vec![0u8; len];
    p.read_exact(&mut body)
}

/// Discord accepts 2 to 128 characters.
fn fit(text: &str, fallback: &str) -> String {
    let t = text.trim();
    let t = if t.chars().count() < 2 { fallback } else { t };
    if t.chars().count() > 128 {
        format!("{}…", t.chars().take(127).collect::<String>())
    } else {
        t.to_string()
    }
}

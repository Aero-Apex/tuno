// What both apps share: where settings live, the settings file, server addresses, versions, and the messages the
// web page sends (see web/src/lib/windows.ts for the page's side).
#![allow(dead_code)] // each platform uses its own subset

use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use serde::Deserialize;

pub const VERSION: &str = env!("TUNO_VERSION");
pub const DEFAULT_SERVER: &str = "https://tuno.eu.cc/";

/// Where settings (and on Windows the browser profile and the on-PC library) live. TUNO_HOME overrides it,
/// which is handy for a portable copy.
pub fn home() -> PathBuf {
    if let Some(h) = std::env::var_os("TUNO_HOME") {
        return PathBuf::from(h);
    }
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        base.join("Tuno")
    }
    #[cfg(not(windows))]
    {
        let base = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        base.join("Library/Application Support/Tuno")
    }
}

/// A tiny key=value file: the server address, the window position and a few switches. The Windows app has used
/// this file since its first version, so existing settings carry over.
pub struct Settings;

fn store() -> &'static Mutex<BTreeMap<String, String>> {
    static STORE: OnceLock<Mutex<BTreeMap<String, String>>> = OnceLock::new();
    STORE.get_or_init(|| {
        let mut map = BTreeMap::new();
        if let Ok(text) = fs::read_to_string(home().join("settings.txt")) {
            for line in text.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    if !k.trim().is_empty() {
                        map.insert(k.trim().to_string(), v.trim().to_string());
                    }
                }
            }
        }
        Mutex::new(map)
    })
}

impl Settings {
    pub fn get(key: &str) -> Option<String> {
        store().lock().unwrap().get(key).filter(|v| !v.is_empty()).cloned()
    }

    pub fn set(key: &str, value: Option<&str>) {
        let mut map = store().lock().unwrap();
        match value {
            Some(v) => map.insert(key.to_string(), v.to_string()),
            None => map.remove(key),
        };
        let text: String = map.iter().map(|(k, v)| format!("{k}={v}\r\n")).collect();
        let _ = fs::create_dir_all(home());
        let _ = fs::write(home().join("settings.txt"), text); // a read-only profile still works, it just won't remember
    }

    pub fn server() -> Option<String> {
        Self::get("server")
    }

    /// Show what's playing on Discord. On unless switched off in Settings → This PC / This Mac.
    pub fn discord() -> bool {
        Self::get("discord").as_deref() != Some("0")
    }
}

/// Turns "192.168.1.5:7070" or "https://music.example.com/" into a usable http(s) address, or None.
pub fn normalize_server(text: &str) -> Option<String> {
    let mut t = text.trim().to_string();
    if t.is_empty() {
        return None;
    }
    if !t.contains("://") {
        t = format!("http://{t}");
    }
    let (scheme, rest) = t.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let (authority, path) = match rest.find(['/', '?', '#']) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let host = authority.rsplit('@').next()?;
    let hostname = host.split(':').next()?;
    if hostname.is_empty() || host.contains(char::is_whitespace) || path.contains(char::is_whitespace) {
        return None;
    }
    if let Some((_, port)) = host.rsplit_once(':') {
        if !host.starts_with('[') && port.parse::<u16>().is_err() {
            return None;
        }
    }
    let path = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
    Some(format!("{scheme}://{}{path}", host.to_ascii_lowercase()))
}

/// "https://host:port" of an address, for same-site checks and for building API addresses.
pub fn origin(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = rest[..end].rsplit('@').next()?.to_ascii_lowercase();
    let scheme = scheme.to_ascii_lowercase();
    let host = match (scheme.as_str(), host.rsplit_once(':')) {
        ("http", Some((h, "80"))) | ("https", Some((h, "443"))) => h.to_string(),
        _ => host,
    };
    Some(format!("{scheme}://{host}"))
}

pub fn same_site(a: &str, b: &str) -> bool {
    matches!((origin(a), origin(b)), (Some(x), Some(y)) if x == y)
}

/// Links that may leave the app for the system browser.
pub fn is_external_link(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

/// A version like 1.2.0, compared numerically.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(pub u32, pub u32, pub u32);

impl Version {
    pub fn parse(s: &str) -> Option<Version> {
        let mut parts = s.trim().split('.').map(|p| p.parse::<u32>());
        let a = parts.next()?.ok()?;
        let b = parts.next().unwrap_or(Ok(0)).ok()?;
        let c = parts.next().unwrap_or(Ok(0)).ok()?;
        Some(Version(a, b, c))
    }

    pub fn current() -> Version {
        Version::parse(VERSION).unwrap_or(Version(0, 0, 0))
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.0, self.1, self.2)
    }
}

/// Everything the web page (and the app's own setup and offline pages) can send.
#[derive(Deserialize, Default, Debug)]
#[serde(default)]
pub struct PageMessage {
    #[serde(rename = "type")]
    pub kind: String,
    pub on: bool,
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub position: f64,
    pub duration: f64,
    /// From the setup page: "local" or "server", and the address typed in.
    pub mode: String,
    pub server: String,
}

/// A message is either a plain string ("change-server", "retry", "fullscreen") or a JSON object.
pub enum Incoming {
    Text(String),
    Message(PageMessage),
}

pub fn parse_message(json: &str) -> Option<Incoming> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    match value {
        serde_json::Value::String(s) => Some(Incoming::Text(s)),
        v @ serde_json::Value::Object(_) => serde_json::from_value(v).ok().map(Incoming::Message),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn servers() {
        assert_eq!(normalize_server("192.168.1.5:7070").as_deref(), Some("http://192.168.1.5:7070/"));
        assert_eq!(normalize_server("https://Music.Example.com").as_deref(), Some("https://music.example.com/"));
        assert_eq!(normalize_server(" https://tuno.eu.cc/ ").as_deref(), Some("https://tuno.eu.cc/"));
        assert_eq!(normalize_server("ftp://x"), None);
        assert_eq!(normalize_server("http://"), None);
        assert_eq!(normalize_server("http://host:notaport/"), None);
        assert_eq!(normalize_server(""), None);
    }

    #[test]
    fn origins() {
        assert!(same_site("https://tuno.eu.cc/settings", "https://tuno.eu.cc/"));
        assert!(same_site("http://a:80/x", "http://a/"));
        assert!(!same_site("http://127.0.0.1:47170/", "http://127.0.0.1:47171/"));
        assert!(!same_site("https://discord.gg/x", "https://tuno.eu.cc/"));
    }

    #[test]
    fn versions() {
        assert!(Version::parse("1.10.0") > Version::parse("1.9.9"));
        assert_eq!(Version::parse("1.2"), Some(Version(1, 2, 0)));
        assert_eq!(Version::parse("x"), None);
    }

    #[test]
    fn messages() {
        match parse_message(r#""change-server""#) {
            Some(Incoming::Text(t)) => assert_eq!(t, "change-server"),
            _ => panic!(),
        }
        match parse_message(r#"{"type":"now-playing","title":"A","playing":true,"position":3.5}"#) {
            Some(Incoming::Message(m)) => {
                assert_eq!(m.kind, "now-playing");
                assert!(m.playing);
                assert_eq!(m.position, 3.5);
            }
            _ => panic!(),
        }
    }
}

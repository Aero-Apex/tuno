// The on-PC edition. The Tuno engine runs on this PC, listens only on 127.0.0.1 and keeps its library here, so no
// server is needed. The library belongs to this PC and this Windows account: the login secret is protected by Windows
// (DPAPI), and the library folder records the PC it was made on, so a copied folder won't open somewhere else.
// Same files, fingerprint and secret as the earlier C# app, so existing libraries keep opening.
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, TcpListener},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use sha2::{Digest, Sha256};
use windows::{
    core::{HSTRING, PWSTR},
    Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL},
        Security::{
            Authorization::ConvertSidToStringSidW,
            Cryptography::{
                BCryptGenRandom, CryptProtectData, CryptUnprotectData, BCRYPT_USE_SYSTEM_PREFERRED_RNG, CRYPTPROTECT_UI_FORBIDDEN,
                CRYPT_INTEGER_BLOB,
            },
            GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER,
        },
        System::{
            Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
            Threading::{GetCurrentProcess, OpenProcessToken},
        },
    },
};

use crate::common::home;

/// A fixed port keeps the page's address (and so its saved settings and "what's new" marker) the same between runs.
const PREFERRED_PORT: u16 = 47170;
const ENTROPY: &[u8] = b"Tuno.LocalEngine.v1";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// What starting the engine gives back: where to load the page from, and the owner's session cookie.
pub struct Session {
    pub url: String,
    pub cookie: String,
}

static ENGINE: Mutex<Option<Child>> = Mutex::new(None);

pub fn root() -> PathBuf {
    home().join("local")
}

fn app_dir() -> PathBuf {
    super::updater::exe_path().parent().map(Path::to_path_buf).unwrap_or_default()
}

struct Engine {
    node: PathBuf,
    ffmpeg: PathBuf,
    ytdlp: PathBuf,
    server_dir: PathBuf,
    web: PathBuf,
}

impl Engine {
    fn locate() -> Engine {
        let e = app_dir().join("engine");
        Engine {
            node: e.join("node.exe"),
            ffmpeg: e.join("ffmpeg.exe"),
            ytdlp: e.join("yt-dlp.exe"),
            server_dir: e.join("server"),
            web: e.join("web").join("dist"),
        }
    }
    fn script(&self) -> PathBuf {
        self.server_dir.join("dist").join("index.js")
    }
    fn cli(&self) -> PathBuf {
        self.server_dir.join("dist").join("cli.js")
    }
    fn installed(&self) -> bool {
        [&self.node, &self.script(), &self.cli(), &self.ytdlp, &self.ffmpeg, &self.web.join("index.html")].iter().all(|p| p.exists())
    }

    /// The settings the engine needs: its own folders, the bundled tools, and a loopback-only address.
    fn command(&self, script: &Path) -> Command {
        let mut c = Command::new(&self.node);
        c.arg(script)
            .current_dir(&self.server_dir)
            .creation_flags(CREATE_NO_WINDOW)
            .env("HOST", "127.0.0.1")
            .env("TUNO_DATA", root().join("data"))
            .env("TUNO_LIBRARY", root().join("library"))
            .env("TUNO_WEB", &self.web)
            .env("YTDLP_EXE", &self.ytdlp)
            .env("YTDLP_JS_RUNTIME", format!("node:{}", self.node.display()))
            .env("FFMPEG", &self.ffmpeg)
            .env("NODE_ENV", "production");
        c
    }
}

/// Starts the engine, makes sure the owner's account exists, and signs in. Call it off the UI thread.
pub fn start() -> Result<Session, String> {
    let engine = Engine::locate();
    if !engine.installed() {
        return Err("The engine folder is missing next to Tuno.exe. Reinstall the on-PC edition.".into());
    }
    device_matches()?;
    let password = load_or_create_password()?;
    let port = pick_port();
    let base = format!("http://127.0.0.1:{port}");
    let log = Arc::new(Mutex::new(fs::File::create(root().join("engine.log")).ok()));
    let where_log = root().display().to_string();
    launch(&engine, port, &log).map_err(|_| format!("The local engine didn't start. Its log is in {where_log}."))?;
    if !wait_for_health(&base, Duration::from_secs(30)) {
        stop();
        return Err(format!("The local engine didn't answer. Its log is in {where_log}."));
    }
    let cookie = match login(&base, &password) {
        Some(c) => Some(c),
        None => {
            // First run on this PC: create the owner's account with the secret we just made, then sign in.
            create_owner(&engine, &password, &log);
            login(&base, &password)
        }
    };
    match cookie {
        Some(cookie) => Ok(Session { url: format!("{base}/"), cookie }),
        None => {
            stop();
            Err(format!("Couldn't sign in to the local engine. Its log is in {where_log}."))
        }
    }
}

/// Stops the engine and anything it started (downloads in progress included).
pub fn stop() {
    if let Some(mut child) = ENGINE.lock().unwrap().take() {
        if child.try_wait().ok().flatten().is_none() {
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            let _ = child.wait();
        }
    }
}

// ---- the device lock ----

/// The library records the PC it was made on. A folder copied from another PC is refused.
fn device_matches() -> Result<(), String> {
    let mark = root().join("device.txt");
    let now = fingerprint();
    let _ = fs::create_dir_all(root());
    match fs::read_to_string(&mark) {
        Err(_) => {
            let _ = fs::write(&mark, &now);
            Ok(())
        }
        Ok(saved) if saved.trim() == now => Ok(()),
        Ok(_) => Err("This music library was made on another PC, so it can't open here. Each library stays on the PC it was made on.".into()),
    }
}

fn fingerprint() -> String {
    let id = format!("{}|{}", machine_guid(), user_sid());
    Sha256::digest(id.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn machine_guid() -> String {
    unsafe {
        let key = HSTRING::from(r"SOFTWARE\Microsoft\Cryptography");
        let name = HSTRING::from("MachineGuid");
        let mut size = 0u32;
        if RegGetValueW(HKEY_LOCAL_MACHINE, &key, &name, RRF_RT_REG_SZ, None, None, Some(&mut size)).is_err() || size == 0 {
            return String::new();
        }
        let mut buf = vec![0u16; size as usize / 2 + 1];
        if RegGetValueW(HKEY_LOCAL_MACHINE, &key, &name, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut _), Some(&mut size)).is_err() {
            return String::new();
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..len])
    }
}

fn user_sid() -> String {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return String::new();
        }
        let mut size = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut size);
        let mut buf = vec![0u8; size as usize];
        let ok = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut _), size, &mut size).is_ok();
        let _ = CloseHandle(token);
        if !ok {
            return String::new();
        }
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut text = PWSTR::null();
        if ConvertSidToStringSidW(user.User.Sid, &mut text).is_err() {
            return String::new();
        }
        let s = text.to_string().unwrap_or_default();
        let _ = LocalFree(Some(HLOCAL(text.0 as *mut _)));
        s
    }
}

/// The owner's secret. Windows encrypts it for this Windows account, so it can't be read on another PC.
fn load_or_create_password() -> Result<String, String> {
    let path = root().join("secret.bin");
    if let Ok(data) = fs::read(&path) {
        return unprotect(&data).ok_or_else(|| "Tuno can't unlock this library on this PC.".to_string());
    }
    let password = random_text(40);
    let blob = protect(password.as_bytes()).ok_or("Tuno can't protect this library's secret on this PC.")?;
    fs::write(&path, blob).map_err(|e| format!("Tuno can't save this library's secret: {e}"))?;
    Ok(password)
}

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
}

fn take_blob(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    unsafe {
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
        v
    }
}

fn protect(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = CRYPT_INTEGER_BLOB::default();
    let entropy = blob(ENTROPY);
    unsafe { CryptProtectData(&blob(data), None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).ok()? };
    Some(take_blob(out))
}

fn unprotect(data: &[u8]) -> Option<String> {
    let mut out = CRYPT_INTEGER_BLOB::default();
    let entropy = blob(ENTROPY);
    unsafe { CryptUnprotectData(&blob(data), None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).ok()? };
    String::from_utf8(take_blob(out)).ok()
}

fn random_text(len: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut bytes = vec![0u8; len];
    unsafe {
        let _ = BCryptGenRandom(None, &mut bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    }
    bytes.iter().map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char).collect()
}

// ---- the engine process ----

fn pick_port() -> u16 {
    if TcpListener::bind((Ipv4Addr::LOCALHOST, PREFERRED_PORT)).is_ok() {
        return PREFERRED_PORT;
    }
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(PREFERRED_PORT)
}

type Log = Arc<Mutex<Option<fs::File>>>;

fn write_log(log: &Log, line: &str) {
    if let Some(f) = log.lock().unwrap().as_mut() {
        let _ = writeln!(f, "{}  {line}", clock());
    }
}

fn clock() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{:02}:{:02}:{:02} UTC", secs / 3600 % 24, secs / 60 % 60, secs % 60)
}

fn pipe_to_log(reader: impl Read + Send + 'static, log: Log) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            write_log(&log, &line);
        }
    });
}

fn launch(engine: &Engine, port: u16, log: &Log) -> std::io::Result<()> {
    stop();
    fs::create_dir_all(root().join("data"))?;
    fs::create_dir_all(root().join("library"))?;
    let mut child = engine.command(&engine.script()).env("PORT", port.to_string()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    if let Some(out) = child.stdout.take() {
        pipe_to_log(out, log.clone());
    }
    if let Some(err) = child.stderr.take() {
        pipe_to_log(err, log.clone());
    }
    *ENGINE.lock().unwrap() = Some(child);
    Ok(())
}

fn running() -> bool {
    ENGINE.lock().unwrap().as_mut().is_some_and(|c| c.try_wait().ok().flatten().is_none())
}

fn http() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build()
}

fn wait_for_health(base: &str, timeout: Duration) -> bool {
    let until = Instant::now() + timeout;
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(2)).build();
    while Instant::now() < until {
        if !running() {
            return false;
        }
        if agent.get(&format!("{base}/api/health")).call().is_ok_and(|r| r.status() == 200) {
            return true;
        }
        thread::sleep(Duration::from_millis(300));
    }
    false
}

/// Signs in and returns the session cookie's value, or None when the password isn't accepted.
fn login(base: &str, password: &str) -> Option<String> {
    let response = http().post(&format!("{base}/api/auth/login")).send_json(serde_json::json!({ "password": password })).ok()?;
    response.all("set-cookie").iter().find_map(|c| {
        let rest = c.split("tuno_session=").nth(1)?;
        Some(rest.split(';').next().unwrap_or(rest).to_string())
    })
}

/// Creates the owner's account in the engine's database (the password goes in on stdin, never on the command line).
fn create_owner(engine: &Engine, password: &str, log: &Log) {
    let Ok(mut cli) = engine.command(&engine.cli()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() else {
        write_log(log, "account: couldn't start the engine's command line");
        return;
    };
    let name = std::env::var("USERNAME").unwrap_or_else(|_| "Owner".into());
    let command = serde_json::json!({ "action": "add-user", "name": name, "password": password, "quotaGb": 500, "admin": true });
    if let Some(mut stdin) = cli.stdin.take() {
        let _ = stdin.write_all(command.to_string().as_bytes());
    }
    let mut output = String::new();
    if let Some(mut out) = cli.stdout.take() {
        let _ = out.read_to_string(&mut output);
    }
    let mut errors = String::new();
    if let Some(mut err) = cli.stderr.take() {
        let _ = err.read_to_string(&mut errors);
    }
    let _ = cli.wait();
    write_log(log, &format!("account: {} {}", output.trim(), errors.trim()));
}

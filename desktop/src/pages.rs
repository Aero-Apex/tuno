// The app's own pages, shown in the web view before (or instead of) your Tuno server's page: the first-run setup,
// "can't reach your server" and "starting Tuno". They talk to the app with post(...), which works in both apps.
#![allow(dead_code)] // the Mac app has no "on this PC" mode, so it skips some of these

const STYLE: &str = r#"<style>
:root{color-scheme:dark}
html,body{height:100%;margin:0;background:#121212;color:#fff;font:15px -apple-system,'Segoe UI',system-ui,sans-serif}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:26px;margin:0;letter-spacing:-.02em}p{color:#b3b3b3;margin:0;max-width:460px;line-height:1.5}code{color:#fff}
.logo{font-weight:800;font-size:20px;letter-spacing:-.03em;margin-bottom:10px}.logo span{color:#1ed760}
.row{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;justify-content:center}
button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:10px 22px;cursor:pointer;background:#1ed760;color:#000}
button.alt{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px #7c7c7c}button:hover{filter:brightness(1.08)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;max-width:520px;width:100%;margin-top:14px}
.card{background:#1f1f1f;border-radius:14px;padding:18px;text-align:left;cursor:pointer;border:1px solid #2a2a2a;color:#fff;font-weight:400}
.card:hover{background:#262626;border-color:#1ed760}.card b{display:block;font-size:16px;margin-bottom:6px}.card small{color:#b3b3b3;line-height:1.45;font-size:13px}
form{display:flex;flex-direction:column;gap:10px;width:100%;max-width:420px;margin-top:10px}
input{font:inherit;background:#2a2a2a;color:#fff;border:1px solid #3a3a3a;border-radius:10px;padding:11px 14px;outline:none}
input:focus{border-color:#1ed760}.error{color:#f15e6c;min-height:1.4em;font-size:14px}
.spinner{width:34px;height:34px;border-radius:50%;border:3px solid #333;border-top-color:#1ed760;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>"#;

const POST: &str = "<script>function post(m){if(window.chrome&&chrome.webview)chrome.webview.postMessage(m);\
else if(window.webkit&&webkit.messageHandlers&&webkit.messageHandlers.tuno)webkit.messageHandlers.tuno.postMessage(m)}</script>";

fn page(body: &str) -> String {
    format!("<!doctype html><meta charset=utf-8><title>Tuno</title>{STYLE}{POST}<div class=logo>Tuno<span>.</span></div>{body}")
}

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into()).replace("</", "<\\/")
}

/// The first-run question (Windows): keep the music on this PC, or connect to a server.
pub fn choose_mode() -> String {
    page(
        r#"<h1>Where should Tuno keep your music?</h1>
<div class=cards>
<button class=card onclick="post({type:'setup',mode:'local'})"><b>On this PC</b><small>Tuno runs by itself, downloads songs to this PC and keeps them private. No server needed.</small></button>
<button class=card onclick="post({type:'setup',mode:'server'})"><b>On a server</b><small>Your music lives on a Tuno server, such as your home server, and every device can play it.</small></button>
</div>"#,
    )
}

/// Asks for the server's address. `cancellable` adds a Cancel button (when changing an existing server).
pub fn ask_server(current: &str, error: &str, cancellable: bool) -> String {
    let cancel = if cancellable { r#"<button type=button class=alt onclick="post({type:'setup-cancel'})">Cancel</button>"# } else { "" };
    page(&format!(
        r#"<h1>Connect to your Tuno server</h1>
<p>Its address, for example <code>http://192.168.1.50:7070</code> or <code>https://music.example.com</code></p>
<form onsubmit="event.preventDefault();post({{type:'setup',mode:'server',server:document.getElementById('s').value}})">
<input id=s autofocus spellcheck=false autocomplete=off value="{value}">
<div class=error>{error}</div>
<div class=row>{cancel}<button>Connect</button></div>
</form>
<script>var i=document.getElementById('s');i.focus();i.setSelectionRange(i.value.length,i.value.length)</script>"#,
        value = escape(current),
        error = escape(error),
    ))
}

/// "Can't reach your Tuno server": keeps checking, and opens the server as soon as it answers.
pub fn offline(server: &str, device: &str) -> String {
    page(&format!(
        r#"<h1>Can't reach your Tuno server</h1>
<p><code>{server_html}</code></p>
<p>Check that it's running and that this {device} is on the same network (or connected to your VPN). Tuno keeps trying and opens as soon as it answers.</p>
<div class=row><button onclick="location.replace(u)">Try again</button><button class=alt onclick="post('change-server')">Change server</button></div>
<script>var u={server_js};setInterval(function(){{fetch(u,{{mode:'no-cors',cache:'no-store'}}).then(function(){{location.replace(u)}},function(){{}})}},4000)</script>"#,
        server_html = escape(server),
        server_js = js_string(server),
    ))
}

/// Shown while the on-PC engine starts.
pub fn starting() -> String {
    page("<div class=spinner></div><p>Starting Tuno on this PC…</p>")
}

/// A problem Tuno can't get past by itself (the on-PC engine didn't start, for example).
pub fn problem(message: &str) -> String {
    page(&format!(
        r#"<h1>Tuno couldn't start</h1><p>{}</p>
<div class=row><button onclick="post('retry')">Try again</button><button class=alt onclick="post('change-server')">Use a server instead</button></div>"#,
        escape(message)
    ))
}

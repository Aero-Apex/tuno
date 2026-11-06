// Tuno for macOS: a small native window (AppKit + WebKit) around your Tuno server's web app.
// It adds what a browser tab can't: its own Dock icon and menu bar, a remembered window, music that keeps playing
// when the window is closed, a "can't reach your server" page that reconnects by itself, and your Discord status.
mod objc;

use std::{cell::RefCell, ffi::c_void, path::PathBuf};

use objc::{class, is_kind, new_object, ns_string, ns_url, rect, responds, send, to_string, url_string, Id, NSSize, Sel, BOOL_ENC, NIL};

use crate::{
    common::{normalize_server, parse_message, same_site, Incoming, PageMessage, Settings, DEFAULT_SERVER},
    discord::Discord,
    pages,
};

const KEY_COMMAND: usize = 1 << 20;
const KEY_SHIFT: usize = 1 << 17;
const KEY_OPTION: usize = 1 << 19;
const KEY_CONTROL: usize = 1 << 18;
const POLICY_CANCEL: isize = 0;
const POLICY_ALLOW: isize = 1;
const POLICY_DOWNLOAD: isize = 2;
const ALERT_FIRST_BUTTON: isize = 1000;
const MODAL_OK: isize = 1;

struct State {
    app: Id,
    window: Id,
    web: Id,
    delegate: Id,
    /// The Tuno page's address, once there is one.
    server: Option<String>,
    discord: Discord,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

fn web() -> Id {
    with(|s| s.web).unwrap_or(NIL)
}

fn server() -> Option<String> {
    with(|s| s.server.clone()).flatten()
}

pub fn run() {
    unsafe {
        objc::load();
        let delegate = register_delegate();
        let app: Id = send(class("NSApplication"), "sharedApplication", ());
        STATE.with(|s| {
            *s.borrow_mut() = Some(State { app, window: NIL, web: NIL, delegate, server: None, discord: Discord::new() })
        });
        send::<()>(app, "setActivationPolicy:", (0isize,)); // a regular app with a Dock icon
        send::<()>(app, "setDelegate:", (delegate,));
        send::<()>(app, "run", ());
    }
}

// ---- startup ----

fn did_finish_launching() {
    unsafe {
        build_menu();
        let web = create_web_view();
        let window = create_window(web);
        with(|s| {
            s.web = web;
            s.window = window;
        });
        // The earlier Go version kept the address in the app's preferences; carry it over once.
        if Settings::server().is_none() {
            let saved = to_string(send(send::<Id>(class("NSUserDefaults"), "standardUserDefaults", ()), "stringForKey:", (ns_string("server"),)));
            if let Some(s) = normalize_server(&saved) {
                Settings::set("server", Some(&s));
            }
        }
        match Settings::server() {
            Some(s) => {
                with(|st| st.server = Some(s));
                navigate_home();
            }
            None => {
                let app = with(|s| s.app).unwrap_or(NIL);
                send::<()>(app, "activateIgnoringOtherApps:", (true,));
                show_page(&pages::ask_server(DEFAULT_SERVER, "", false));
            }
        }
    }
}

fn app_version() -> String {
    unsafe {
        let bundle: Id = send(class("NSBundle"), "mainBundle", ());
        let v = to_string(send(bundle, "objectForInfoDictionaryKey:", (ns_string("CFBundleShortVersionString"),)));
        if v.is_empty() {
            crate::common::VERSION.to_string()
        } else {
            v
        }
    }
}

fn back_color() -> Id {
    unsafe { send(class("NSColor"), "colorWithSRGBRed:green:blue:alpha:", (18.0f64 / 255.0, 18.0f64 / 255.0, 18.0f64 / 255.0, 1.0f64)) }
}

unsafe fn create_web_view() -> Id {
    let delegate = with(|s| s.delegate).unwrap_or(NIL);
    let config = new_object("WKWebViewConfiguration");
    // Music has to start without a click (the next song in the queue, Autoplay).
    send::<()>(config, "setMediaTypesRequiringUserActionForPlayback:", (0usize,));
    // The web page reads this to know it's in the Mac app ("TunoMac/1.2.0"). Safari's token keeps sites happy.
    send::<()>(config, "setApplicationNameForUserAgent:", (ns_string(&format!("Version/17.0 Safari/605.1.15 TunoMac/{}", app_version())),));
    let prefs: Id = send(config, "preferences", ());
    if responds(prefs, "setElementFullscreenEnabled:") {
        send::<()>(prefs, "setElementFullscreenEnabled:", (true,));
    }
    // The page talks to the app through window.webkit.messageHandlers.tuno (see web/src/lib/windows.ts).
    let content: Id = send(config, "userContentController", ());
    send::<()>(content, "addScriptMessageHandler:name:", (delegate, ns_string("tuno")));

    let web: Id = send(send::<Id>(class("WKWebView"), "alloc", ()), "initWithFrame:configuration:", (rect(0.0, 0.0, 1280.0, 820.0), config));
    send::<()>(web, "setNavigationDelegate:", (delegate,));
    send::<()>(web, "setUIDelegate:", (delegate,));
    send::<()>(web, "setAllowsBackForwardNavigationGestures:", (false,));
    let no: Id = send(class("NSNumber"), "numberWithBool:", (false,));
    send::<()>(web, "setValue:forKey:", (no, ns_string("drawsBackground"))); // no white flash while loading
    if responds(web, "setUnderPageBackgroundColor:") {
        send::<()>(web, "setUnderPageBackgroundColor:", (back_color(),));
    }
    send::<()>(web, "addObserver:forKeyPath:options:context:", (delegate, ns_string("title"), 1usize, std::ptr::null_mut::<c_void>()));
    web
}

unsafe fn create_window(web: Id) -> Id {
    let delegate = with(|s| s.delegate).unwrap_or(NIL);
    let style = 1usize | 2 | 4 | 8; // titled, closable, miniaturizable, resizable
    let window: Id = send(send::<Id>(class("NSWindow"), "alloc", ()), "initWithContentRect:styleMask:backing:defer:", (rect(0.0, 0.0, 1280.0, 820.0), style, 2usize, false));
    send::<()>(window, "setReleasedWhenClosed:", (false,));
    send::<()>(window, "setTitle:", (ns_string("Tuno"),));
    send::<()>(window, "setMinSize:", (NSSize { width: 380.0, height: 520.0 },));
    send::<()>(window, "setBackgroundColor:", (back_color(),));
    let dark: Id = send(class("NSAppearance"), "appearanceNamed:", (ns_string("NSAppearanceNameDarkAqua"),));
    send::<()>(window, "setAppearance:", (dark,));
    send::<()>(window, "setTitlebarAppearsTransparent:", (true,));
    send::<()>(window, "setTabbingMode:", (2isize,)); // no tabs
    let behavior: usize = send(window, "collectionBehavior", ());
    send::<()>(window, "setCollectionBehavior:", (behavior | (1 << 7),)); // full-screen capable
    send::<()>(window, "setContentView:", (web,));
    send::<()>(window, "setDelegate:", (delegate,));
    send::<()>(window, "center", ());
    send::<()>(window, "setFrameAutosaveName:", (ns_string("TunoMain"),)); // remembers size and position
    send::<()>(window, "makeKeyAndOrderFront:", (NIL,));
    let app = with(|s| s.app).unwrap_or(NIL);
    send::<()>(app, "activateIgnoringOtherApps:", (true,));
    window
}

// ---- navigation ----

fn show_page(html: &str) {
    unsafe { send::<()>(web(), "loadHTMLString:baseURL:", (ns_string(html), NIL)) }
}

fn load(url: &str) {
    let u = ns_url(url);
    if u.is_null() {
        show_offline();
        return;
    }
    unsafe {
        let request: Id = send(class("NSURLRequest"), "requestWithURL:", (u,));
        send::<()>(web(), "loadRequest:", (request,));
    }
}

fn navigate_home() {
    match server() {
        Some(s) => load(&s),
        None => show_page(&pages::ask_server(DEFAULT_SERVER, "", false)),
    }
}

fn show_offline() {
    show_page(&pages::offline(&server().unwrap_or_default(), "Mac"));
}

fn reload() {
    navigate_home();
}

fn open_settings() {
    if let Some(s) = server().and_then(|s| crate::common::origin(&s)) {
        load(&format!("{s}/settings"));
    }
}

fn change_server() {
    let current = server();
    show_page(&pages::ask_server(current.as_deref().unwrap_or(DEFAULT_SERVER), "", current.is_some()));
}

fn open_external(url: &str) {
    if !crate::common::is_external_link(url) {
        return;
    }
    let u = ns_url(url);
    if !u.is_null() {
        unsafe { send::<()>(send::<Id>(class("NSWorkspace"), "sharedWorkspace", ()), "openURL:", (u,)) }
    }
}

fn is_tuno(url: &str) -> bool {
    server().is_some_and(|s| same_site(url, &s))
}

// ---- messages from the page ----

fn on_page_message(body: Id) {
    let incoming = if is_kind(body, "NSString") {
        Some(Incoming::Text(to_string(body)))
    } else if is_kind(body, "NSDictionary") {
        let data: Id = unsafe { send(class("NSJSONSerialization"), "dataWithJSONObject:options:error:", (body, 0usize, NIL)) };
        if data.is_null() {
            return;
        }
        parse_message(&String::from_utf8_lossy(&objc::data_bytes(data)))
    } else {
        None
    };
    match incoming {
        Some(Incoming::Text(t)) => match t.as_str() {
            "change-server" => change_server(),
            "retry" => navigate_home(),
            _ => {}
        },
        Some(Incoming::Message(m)) => match m.kind.as_str() {
            "now-playing" => now_playing(&m),
            "set-discord" => {
                Settings::set("discord", Some(if m.on { "1" } else { "0" }));
                if !m.on {
                    with(|s| s.discord.clear());
                }
                post_status();
            }
            "get-status" => post_status(),
            "setup" => setup(&m),
            "setup-cancel" => {
                if server().is_some() {
                    navigate_home();
                }
            }
            _ => {}
        },
        None => {}
    }
}

/// An answer from the server form.
fn setup(m: &PageMessage) {
    match normalize_server(&m.server) {
        Some(s) => {
            Settings::set("server", Some(&s));
            with(|st| st.server = Some(s));
            navigate_home();
        }
        None => {
            let cancel = server().is_some();
            show_page(&pages::ask_server(&m.server, "That doesn't look like a web address.", cancel));
        }
    }
}

fn now_playing(m: &PageMessage) {
    with(|s| {
        if Settings::discord() && m.playing && !m.title.is_empty() {
            s.discord.show(&m.title, &m.artist, m.position, m.duration);
        } else {
            s.discord.clear();
        }
    });
}

/// Tells the page the app's settings (Settings → This Mac reads the Discord switch from it).
fn post_status() {
    let json = serde_json::json!({ "type": "update-status", "state": "idle", "auto": false, "local": false, "discord": Settings::discord() });
    let js = format!("window.dispatchEvent(new CustomEvent('tuno-message',{{detail:{json}}}))");
    unsafe { send::<()>(web(), "evaluateJavaScript:completionHandler:", (ns_string(&js), NIL)) }
}

// ---- downloads ----

/// ~/Downloads/<name>, adding " 2", " 3"… if a file is already there, like Safari.
fn download_target(name: &str) -> PathBuf {
    let folder = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join("Downloads");
    let name = std::path::Path::new(if name.is_empty() { "download" } else { name }).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "download".into());
    let path = std::path::Path::new(&name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut target = folder.join(&name);
    let mut n = 2;
    while target.exists() {
        target = folder.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    target
}

// ---- menu ----

unsafe fn build_menu() {
    let bar = new_object("NSMenu");

    let app_menu = submenu(bar, "Tuno");
    item(app_menu, "About Tuno", "orderFrontStandardAboutPanel:", "", 0, false);
    separator(app_menu);
    item(app_menu, "Settings…", "tunoSettings:", ",", 0, true);
    item(app_menu, "Change Server…", "tunoChangeServer:", "", 0, true);
    separator(app_menu);
    item(app_menu, "Hide Tuno", "hide:", "h", 0, false);
    item(app_menu, "Hide Others", "hideOtherApplications:", "h", KEY_COMMAND | KEY_OPTION, false);
    item(app_menu, "Show All", "unhideAllApplications:", "", 0, false);
    separator(app_menu);
    item(app_menu, "Quit Tuno", "terminate:", "q", 0, false);

    // Without an Edit menu, ⌘C / ⌘V / ⌘A don't work in the web page's text boxes.
    let edit = submenu(bar, "Edit");
    item(edit, "Undo", "undo:", "z", 0, false);
    item(edit, "Redo", "redo:", "z", KEY_COMMAND | KEY_SHIFT, false);
    separator(edit);
    item(edit, "Cut", "cut:", "x", 0, false);
    item(edit, "Copy", "copy:", "c", 0, false);
    item(edit, "Paste", "paste:", "v", 0, false);
    item(edit, "Select All", "selectAll:", "a", 0, false);

    let view = submenu(bar, "View");
    item(view, "Reload", "tunoReload:", "r", 0, true);
    item(view, "Enter Full Screen", "toggleFullScreen:", "f", KEY_COMMAND | KEY_CONTROL, false);

    let win = submenu(bar, "Window");
    item(win, "Minimize", "performMiniaturize:", "m", 0, false);
    item(win, "Zoom", "performZoom:", "", 0, false);
    separator(win);
    item(win, "Tuno", "tunoShowWindow:", "0", 0, true);

    let app = with(|s| s.app).unwrap_or(NIL);
    send::<()>(app, "setWindowsMenu:", (win,));
    send::<()>(app, "setMainMenu:", (bar,));
}

unsafe fn submenu(bar: Id, title: &str) -> Id {
    let menu: Id = send(send::<Id>(class("NSMenu"), "alloc", ()), "initWithTitle:", (ns_string(title),));
    let holder: Id = send(send::<Id>(class("NSMenuItem"), "alloc", ()), "initWithTitle:action:keyEquivalent:", (ns_string(title), std::ptr::null::<c_void>(), ns_string("")));
    send::<()>(holder, "setSubmenu:", (menu,));
    send::<()>(bar, "addItem:", (holder,));
    menu
}

/// A menu item. Our own items (mine) go to the delegate; standard ones go to whatever is focused.
unsafe fn item(menu: Id, title: &str, action: &str, key: &str, modifiers: usize, mine: bool) {
    let it: Id = send(send::<Id>(class("NSMenuItem"), "alloc", ()), "initWithTitle:action:keyEquivalent:", (ns_string(title), objc::sel(action), ns_string(key)));
    if modifiers != 0 {
        send::<()>(it, "setKeyEquivalentModifierMask:", (modifiers,));
    }
    if mine {
        send::<()>(it, "setTarget:", (with(|s| s.delegate).unwrap_or(NIL),));
    }
    send::<()>(menu, "addItem:", (it,));
}

unsafe fn separator(menu: Id) {
    let sep: Id = send(class("NSMenuItem"), "separatorItem", ());
    send::<()>(menu, "addItem:", (sep,));
}

// ---- the delegate: one object answers for the app, the window, the web view and downloads ----

extern "C" fn did_finish(_: Id, _: Sel, _: Id) {
    did_finish_launching();
}

extern "C" fn should_reopen(_: Id, _: Sel, _: Id, visible: bool) -> bool {
    if !visible {
        if let Some(w) = with(|s| s.window) {
            unsafe { send::<()>(w, "makeKeyAndOrderFront:", (NIL,)) }
        }
    }
    true
}

extern "C" fn no(_: Id, _: Sel, _: Id) -> bool {
    false
}

extern "C" fn yes(_: Id, _: Sel, _: Id) -> bool {
    true
}

/// Closing the window hides it, so the music keeps playing (like Spotify). Quit with ⌘Q.
extern "C" fn window_should_close(_: Id, _: Sel, window: Id) -> bool {
    unsafe { send::<()>(window, "orderOut:", (NIL,)) };
    false
}

/// The page title becomes the window title.
extern "C" fn title_changed(_: Id, _: Sel, _: Id, _: Id, _: Id, _: *mut c_void) {
    let title = to_string(unsafe { send(web(), "title", ()) });
    let title = if title.trim().is_empty() { "Tuno".to_string() } else { title };
    if let Some(w) = with(|s| s.window) {
        unsafe { send::<()>(w, "setTitle:", (ns_string(&title),)) }
    }
}

extern "C" fn menu_reload(_: Id, _: Sel, _: Id) {
    reload();
}
extern "C" fn menu_change_server(_: Id, _: Sel, _: Id) {
    change_server();
}
extern "C" fn menu_settings(_: Id, _: Sel, _: Id) {
    open_settings();
}
extern "C" fn menu_show_window(_: Id, _: Sel, _: Id) {
    if let Some(w) = with(|s| s.window) {
        unsafe { send::<()>(w, "makeKeyAndOrderFront:", (NIL,)) }
    }
}

extern "C" fn script_message(_: Id, _: Sel, _: Id, message: Id) {
    on_page_message(unsafe { send(message, "body", ()) });
}

extern "C" fn decide_action(_: Id, _: Sel, _: Id, action: Id, handler: Id) {
    unsafe {
        if responds(action, "shouldPerformDownload") && send::<bool>(action, "shouldPerformDownload", ()) {
            objc::call_block_1(handler, POLICY_DOWNLOAD);
            return;
        }
        // Links to other sites open in the browser; Tuno itself stays in the window.
        if send::<isize>(action, "navigationType", ()) == 0 {
            let url = url_string(send(send::<Id>(action, "request", ()), "URL", ()));
            if !url.is_empty() && !url.starts_with("about:") && !is_tuno(&url) {
                open_external(&url);
                objc::call_block_1(handler, POLICY_CANCEL);
                return;
            }
        }
        objc::call_block_1(handler, POLICY_ALLOW);
    }
}

extern "C" fn decide_response(_: Id, _: Sel, _: Id, response: Id, handler: Id) {
    unsafe {
        // Files the web view can't show (an APK, an installer) are saved to Downloads.
        if !send::<bool>(response, "canShowMIMEType", ()) {
            if !class("WKDownload").is_null() {
                objc::call_block_1(handler, POLICY_DOWNLOAD);
                return;
            }
            open_external(&url_string(send(send::<Id>(response, "response", ()), "URL", ())));
            objc::call_block_1(handler, POLICY_CANCEL);
            return;
        }
        objc::call_block_1(handler, POLICY_ALLOW);
    }
}

extern "C" fn did_fail_provisional(_: Id, _: Sel, _: Id, _: Id, error: Id) {
    unsafe {
        if to_string(send(error, "domain", ())) != "NSURLErrorDomain" {
            return;
        }
        // can't connect, host not found, timed out, connection lost, offline, DNS, TLS
        if [-1004, -1003, -1001, -1005, -1009, -1006, -1200].contains(&send::<isize>(error, "code", ())) {
            show_offline();
        }
    }
}

extern "C" fn content_process_ended(_: Id, _: Sel, web_view: Id) {
    unsafe { send::<()>(web_view, "reload", ()) }
}

extern "C" fn became_download(this: Id, _: Sel, _: Id, _: Id, download: Id) {
    unsafe { send::<()>(download, "setDelegate:", (this,)) }
}

extern "C" fn download_destination(_: Id, _: Sel, _: Id, _: Id, name: Id, handler: Id) {
    let target = download_target(&to_string(name));
    unsafe {
        let url: Id = send(class("NSURL"), "fileURLWithPath:", (ns_string(&target.to_string_lossy()),));
        objc::call_block_1(handler, url);
    }
}

extern "C" fn download_finished(_: Id, _: Sel, _: Id) {
    unsafe {
        let sound: Id = send(class("NSSound"), "soundNamed:", (ns_string("Glass"),));
        if !sound.is_null() {
            send::<bool>(sound, "play", ());
        }
    }
}

/// target="_blank": Tuno pages open here, everything else in the browser.
extern "C" fn create_web_view_for(_: Id, _: Sel, web_view: Id, _: Id, action: Id, _: Id) -> Id {
    unsafe {
        let request: Id = send(action, "request", ());
        let url = url_string(send(request, "URL", ()));
        if is_tuno(&url) {
            send::<()>(web_view, "loadRequest:", (request,));
        } else {
            open_external(&url);
        }
    }
    NIL
}

extern "C" fn open_panel(_: Id, _: Sel, _: Id, params: Id, _: Id, handler: Id) {
    unsafe {
        let panel: Id = send(class("NSOpenPanel"), "openPanel", ());
        send::<()>(panel, "setAllowsMultipleSelection:", (send::<bool>(params, "allowsMultipleSelection", ()),));
        send::<()>(panel, "setCanChooseDirectories:", (false,));
        send::<()>(panel, "setCanChooseFiles:", (true,));
        if send::<isize>(panel, "runModal", ()) == MODAL_OK {
            objc::call_block_1(handler, send::<Id>(panel, "URLs", ()));
        } else {
            objc::call_block_1(handler, NIL);
        }
    }
}

extern "C" fn js_alert(_: Id, _: Sel, _: Id, text: Id, _: Id, handler: Id) {
    unsafe {
        let alert = new_object("NSAlert");
        send::<()>(alert, "setMessageText:", (text,));
        send::<isize>(alert, "runModal", ());
        objc::call_block_0(handler);
    }
}

extern "C" fn js_confirm(_: Id, _: Sel, _: Id, text: Id, _: Id, handler: Id) {
    unsafe {
        let alert = new_object("NSAlert");
        send::<()>(alert, "setMessageText:", (text,));
        send::<Id>(alert, "addButtonWithTitle:", (ns_string("OK"),));
        send::<Id>(alert, "addButtonWithTitle:", (ns_string("Cancel"),));
        objc::call_block_1(handler, send::<isize>(alert, "runModal", ()) == ALERT_FIRST_BUTTON);
    }
}

unsafe fn register_delegate() -> Id {
    let b = BOOL_ENC;
    let v_obj = "v@:@";
    let b_obj = format!("{b}@:@");
    let reopen = format!("{b}@:@{b}");
    let methods: Vec<(&str, *const c_void, &str)> = vec![
        ("applicationDidFinishLaunching:", did_finish as *const c_void, v_obj),
        ("applicationShouldHandleReopen:hasVisibleWindows:", should_reopen as *const c_void, &reopen),
        ("applicationShouldTerminateAfterLastWindowClosed:", no as *const c_void, &b_obj),
        ("applicationSupportsSecureRestorableState:", yes as *const c_void, &b_obj),
        ("windowShouldClose:", window_should_close as *const c_void, &b_obj),
        ("observeValueForKeyPath:ofObject:change:context:", title_changed as *const c_void, "v@:@@@^v"),
        ("tunoReload:", menu_reload as *const c_void, v_obj),
        ("tunoChangeServer:", menu_change_server as *const c_void, v_obj),
        ("tunoSettings:", menu_settings as *const c_void, v_obj),
        ("tunoShowWindow:", menu_show_window as *const c_void, v_obj),
        ("userContentController:didReceiveScriptMessage:", script_message as *const c_void, "v@:@@"),
        ("webView:decidePolicyForNavigationAction:decisionHandler:", decide_action as *const c_void, "v@:@@@?"),
        ("webView:decidePolicyForNavigationResponse:decisionHandler:", decide_response as *const c_void, "v@:@@@?"),
        ("webView:didFailProvisionalNavigation:withError:", did_fail_provisional as *const c_void, "v@:@@@"),
        ("webViewWebContentProcessDidTerminate:", content_process_ended as *const c_void, v_obj),
        ("webView:navigationAction:didBecomeDownload:", became_download as *const c_void, "v@:@@@"),
        ("webView:navigationResponse:didBecomeDownload:", became_download as *const c_void, "v@:@@@"),
        ("download:decideDestinationUsingResponse:suggestedFilename:completionHandler:", download_destination as *const c_void, "v@:@@@@?"),
        ("downloadDidFinish:", download_finished as *const c_void, v_obj),
        ("webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:", create_web_view_for as *const c_void, "@@:@@@@"),
        ("webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:", open_panel as *const c_void, "v@:@@@@?"),
        ("webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:", js_alert as *const c_void, "v@:@@@@?"),
        ("webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:", js_confirm as *const c_void, "v@:@@@@?"),
    ];
    let cls = objc::make_class(
        "TunoDelegate",
        "NSObject",
        &["NSApplicationDelegate", "NSWindowDelegate", "WKNavigationDelegate", "WKUIDelegate", "WKScriptMessageHandler", "WKDownloadDelegate"],
        &methods,
    );
    send(send::<Id>(cls, "alloc", ()), "init", ())
}

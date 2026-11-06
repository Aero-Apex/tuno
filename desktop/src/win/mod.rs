// Tuno for Windows: a thin native window around the WebView2 runtime that ships with Windows, pointed at your own
// Tuno server (or at the engine running on this PC). No bundled browser, no background services.
mod local;
mod sys;
mod updater;

use std::{
    cell::{Cell, RefCell},
    ffi::c_void,
    rc::Rc,
    sync::{
        atomic::{AtomicIsize, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::{Interface, BOOL, HRESULT, HSTRING, PCWSTR, PWSTR},
    Win32::{
        Foundation::{E_POINTER, HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{GetMonitorInfoW, GetStockObject, MonitorFromRect, MonitorFromWindow, BLACK_BRUSH, HBRUSH, MONITORINFO, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL},
        System::{
            Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
            LibraryLoader::GetModuleHandleW,
        },
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::*},
    },
};

use crate::{
    common::{normalize_server, parse_message, same_site, Incoming, PageMessage, Settings, Version, DEFAULT_SERVER, VERSION},
    discord::Discord,
    pages,
};

const CMD_CHANGE_SERVER: u32 = 0x1010;
const CMD_RELOAD: u32 = 0x1020;
const CMD_CHECK_UPDATE: u32 = 0x1030;
const CMD_AUTO_UPDATE: u32 = 0x1040;
const CMD_SWITCH_MODE: u32 = 0x1050;
/// Updates always come from the public feed when the music is kept on this PC.
const UPDATE_FEED: &str = "https://tuno.eu.cc/";
/// Autoplay: a music app starts the next song without a click. The rest keeps the profile small.
const BROWSER_ARGS: &str = "--autoplay-policy=no-user-gesture-required --disable-features=Translate,msEdgeShoppingUI,msEdgeFollow";
/// A background job finished: run what it queued on the window's thread.
const WM_APP_TASK: u32 = WM_APP + 1;
const TICK: usize = 1;

// WebView2's loader, linked into the exe (no WebView2Loader.dll next to it).
#[link(name = "WebView2LoaderStatic", kind = "static")]
extern "system" {
    fn CreateCoreWebView2EnvironmentWithOptions(browser_folder: PCWSTR, user_data: PCWSTR, options: *mut c_void, handler: *mut c_void) -> HRESULT;
}
#[link(name = "version")]
#[link(name = "advapi32")]
#[link(name = "shell32")]
#[link(name = "ole32")]
extern "system" {}

fn local_mode() -> bool {
    Settings::get("mode").as_deref() == Some("local")
}

fn auto_update() -> bool {
    Settings::get("autoUpdate").as_deref() != Some("0")
}

/// What the window is showing, which decides what "Cancel" and status messages mean.
#[derive(Clone, Copy, PartialEq)]
enum Showing {
    Nothing,
    Setup,
    Tuno,
    Offline,
}

struct Saved {
    style: isize,
    placement: WINDOWPLACEMENT,
}

struct App {
    hwnd: HWND,
    controller: RefCell<Option<ICoreWebView2Controller>>,
    webview: RefCell<Option<ICoreWebView2>>,
    /// The address of the Tuno page: your server, or the engine on this PC.
    server: RefCell<Option<String>>,
    showing: Cell<Showing>,
    fullscreen: RefCell<Option<Saved>>,
    checking: Cell<bool>,
    pending: Cell<Option<Version>>,
    next_check: Cell<Instant>,
    idle_ticks: Cell<u32>,
    trimmed: Cell<bool>,
    discord: Discord,
}

thread_local! {
    static APP: RefCell<Option<Rc<App>>> = const { RefCell::new(None) };
}

fn app() -> Option<Rc<App>> {
    APP.with(|a| a.borrow().clone())
}

static MAIN_WINDOW: AtomicIsize = AtomicIsize::new(0);
type Task = Box<dyn FnOnce() + Send>;
static TASKS: Mutex<Vec<Task>> = Mutex::new(Vec::new());

/// Runs `f` on the window's thread, after the current event. Background threads use it to report back, and event
/// handlers use it to act without re-entering WebView2 mid-event.
fn on_ui(f: impl FnOnce() + Send + 'static) {
    TASKS.lock().unwrap().push(Box::new(f));
    unsafe {
        let _ = PostMessageW(Some(HWND(MAIN_WINDOW.load(Ordering::SeqCst) as *mut c_void)), WM_APP_TASK, WPARAM(0), LPARAM(0));
    }
}

pub fn run() {
    sys::set_app_id();
    let args: Vec<String> = std::env::args().skip(1).collect();
    // "--after-update" means the previous version is still shutting down: wait for it instead of treating it as a second copy.
    let after_update = args.iter().any(|a| a == "--after-update");
    let mut lock = None;
    for attempt in 0..if after_update { 30 } else { 1 } {
        if attempt > 0 {
            thread::sleep(Duration::from_millis(500));
        }
        lock = sys::InstanceLock::take();
        if lock.is_some() {
            break;
        }
    }
    let Some(_lock) = lock else {
        sys::focus_running_instance();
        return;
    };

    updater::clean_up_old_version();
    // A newer build downloaded earlier is installed right now, before any window shows.
    if auto_update() && updater::try_apply_pending() && updater::restart() {
        return;
    }
    // An address on the command line connects to that server.
    if let Some(address) = args.iter().find(|a| !a.starts_with("--")).and_then(|a| normalize_server(a)) {
        Settings::set("server", Some(&address));
        Settings::set("mode", Some("server"));
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let hwnd = create_window();
    MAIN_WINDOW.store(hwnd.0 as isize, Ordering::SeqCst);
    let app = Rc::new(App {
        hwnd,
        controller: RefCell::new(None),
        webview: RefCell::new(None),
        server: RefCell::new(None),
        showing: Cell::new(Showing::Nothing),
        fullscreen: RefCell::new(None),
        checking: Cell::new(false),
        pending: Cell::new(updater::pending_version()),
        next_check: Cell::new(Instant::now()),
        idle_ticks: Cell::new(0),
        trimmed: Cell::new(false),
        discord: Discord::new(),
    });
    APP.with(|a| *a.borrow_mut() = Some(app.clone()));

    if let Err(e) = create_webview(&app) {
        let missing = matches!(&e, webview2_com::Error::WindowsError(w) if w.code().0 as u32 == 0x8007_0002);
        if missing {
            let answer = sys::message(
                hwnd,
                "Tuno needs the Microsoft Edge WebView2 Runtime, which is free and small. Open the download page?",
                MB_YESNO | MB_ICONINFORMATION,
            );
            if answer == IDYES {
                sys::open_external("https://developer.microsoft.com/microsoft-edge/webview2/");
            }
        } else {
            sys::message(hwnd, &format!("Tuno couldn't start its web view:\n\n{e:?}"), MB_OK | MB_ICONERROR);
        }
        unsafe {
            let _ = DestroyWindow(hwnd);
        }
        return;
    }
    resize_webview(&app);
    begin(&app);
    unsafe {
        SetTimer(Some(hwnd), TICK, 30_000, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    local::stop();
    app.discord.clear();
    // A downloaded update goes in when Tuno closes, so the next start is the new version.
    if auto_update() {
        updater::try_apply_pending();
    }
}

// ---- the window ----

fn create_window() -> HWND {
    unsafe {
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let class = HSTRING::from(sys::WINDOW_CLASS);
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            hIcon: LoadIconW(Some(instance.into()), PCWSTR(1 as *const u16)).unwrap_or_default(),
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };
        RegisterClassExW(&wc);
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            &class,
            &HSTRING::from("Tuno"),
            WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            1280,
            820,
            None,
            None,
            Some(instance.into()),
            None,
        )
        .expect("window");
        sys::dark_title_bar(hwnd);
        add_menu(hwnd);
        restore_bounds(hwnd);
        hwnd
    }
}

fn scale(hwnd: HWND, v: i32) -> i32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    v * if dpi == 0 { 96 } else { dpi as i32 } / 96
}

/// Puts the window where it was last time, if that's still on a screen; otherwise centres it.
fn restore_bounds(hwnd: HWND) {
    unsafe {
        let saved: Vec<i32> = Settings::get("bounds").unwrap_or_default().split(',').filter_map(|p| p.trim().parse().ok()).collect();
        let mut placed = false;
        if let [x, y, w, h] = saved[..] {
            let r = RECT { left: x, top: y, right: x + w, bottom: y + h };
            if !MonitorFromRect(&r, MONITOR_DEFAULTTONULL).is_invalid() && w >= 380 && h >= 520 {
                let _ = SetWindowPos(hwnd, None, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
                placed = true;
            }
        }
        if !placed {
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let _ = GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info);
            let work = info.rcWork;
            let (w, h) = (scale(hwnd, 1280).min(work.right - work.left), scale(hwnd, 820).min(work.bottom - work.top));
            let _ = SetWindowPos(hwnd, None, work.left + (work.right - work.left - w) / 2, work.top + (work.bottom - work.top - h) / 2, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
        }
        let _ = ShowWindow(hwnd, if Settings::get("maximized").as_deref() == Some("1") { SW_SHOWMAXIMIZED } else { SW_SHOW });
    }
}

fn save_bounds(app: &App) {
    unsafe {
        let mut placement = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
        if let Some(saved) = app.fullscreen.borrow().as_ref() {
            placement = saved.placement;
        } else if GetWindowPlacement(app.hwnd, &mut placement).is_err() {
            return;
        }
        let maximized = placement.showCmd == SW_SHOWMAXIMIZED.0 as u32;
        let mut r = placement.rcNormalPosition;
        if !maximized && placement.showCmd != SW_SHOWMINIMIZED.0 as u32 && app.fullscreen.borrow().is_none() {
            let _ = GetWindowRect(app.hwnd, &mut r);
        }
        Settings::set("bounds", Some(&format!("{},{},{},{}", r.left, r.top, r.right - r.left, r.bottom - r.top)));
        Settings::set("maximized", Some(if maximized { "1" } else { "0" }));
    }
}

fn add_menu(hwnd: HWND) {
    sys::add_system_menu_items(
        hwnd,
        &[
            (CMD_RELOAD, "Reload\tF5".into()),
            (CMD_CHANGE_SERVER, server_menu_label().into()),
            (CMD_SWITCH_MODE, "Run on this PC only...".into()),
            (CMD_CHECK_UPDATE, format!("Check for updates (v{})", Version::current())),
            (CMD_AUTO_UPDATE, "Update automatically".into()),
        ],
    );
    sys::set_menu_check(hwnd, CMD_AUTO_UPDATE, auto_update());
}

fn server_menu_label() -> &'static str {
    if local_mode() {
        "Connect to a Tuno server..."
    } else {
        "Change server..."
    }
}

fn refresh_menu(hwnd: HWND) {
    unsafe {
        let menu = GetSystemMenu(hwnd, false);
        let _ = ModifyMenuW(menu, CMD_CHANGE_SERVER, MF_BYCOMMAND | MF_STRING, CMD_CHANGE_SERVER as usize, &HSTRING::from(server_menu_label()));
    }
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_SIZE => {
            if let Some(app) = app() {
                resize_webview(&app);
                let minimized = wparam.0 as u32 == SIZE_MINIMIZED;
                // A minimized music player doesn't need its page cached in memory (the music keeps playing).
                set_memory_target(&app, minimized);
                if minimized {
                    sys::trim_working_set();
                } else {
                    resume_web(&app);
                }
            }
            LRESULT(0)
        }
        WM_MOVE => {
            if let Some(c) = app().and_then(|a| a.controller.borrow().clone()) {
                let _ = c.NotifyParentWindowPositionChanged();
            }
            LRESULT(0)
        }
        WM_SETFOCUS => {
            if let Some(c) = app().and_then(|a| a.controller.borrow().clone()) {
                let _ = c.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            }
            LRESULT(0)
        }
        WM_GETMINMAXINFO => {
            let info = &mut *(lparam.0 as *mut MINMAXINFO);
            info.ptMinTrackSize.x = scale(hwnd, 380);
            info.ptMinTrackSize.y = scale(hwnd, 520);
            LRESULT(0)
        }
        WM_DPICHANGED => {
            let r = &*(lparam.0 as *const RECT);
            let _ = SetWindowPos(hwnd, None, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOZORDER | SWP_NOACTIVATE);
            LRESULT(0)
        }
        WM_SYSCOMMAND => {
            let cmd = wparam.0 as u32 & 0xFFF0;
            if let Some(app) = app() {
                match cmd {
                    CMD_CHANGE_SERVER => {
                        change_server(&app);
                        return LRESULT(0);
                    }
                    CMD_SWITCH_MODE => {
                        if !local_mode() {
                            Settings::set("mode", Some("local"));
                            refresh_menu(hwnd);
                            start_local(&app);
                        }
                        return LRESULT(0);
                    }
                    CMD_RELOAD => {
                        begin(&app);
                        return LRESULT(0);
                    }
                    CMD_CHECK_UPDATE => {
                        start_update_check(&app, true, false);
                        return LRESULT(0);
                    }
                    CMD_AUTO_UPDATE => {
                        Settings::set("autoUpdate", Some(if auto_update() { "0" } else { "1" }));
                        sys::set_menu_check(hwnd, CMD_AUTO_UPDATE, auto_update());
                        return LRESULT(0);
                    }
                    _ => {}
                }
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_TIMER => {
            if let Some(app) = app() {
                on_tick(&app);
            }
            LRESULT(0)
        }
        WM_APP_TASK => {
            let tasks: Vec<Task> = std::mem::take(&mut *TASKS.lock().unwrap());
            for task in tasks {
                task();
            }
            LRESULT(0)
        }
        WM_CLOSE => {
            if let Some(app) = app() {
                save_bounds(&app);
            }
            let _ = DestroyWindow(hwnd);
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn resize_webview(app: &App) {
    if let Some(c) = app.controller.borrow().as_ref() {
        let mut r = RECT::default();
        unsafe {
            let _ = GetClientRect(app.hwnd, &mut r);
            let _ = c.SetBounds(r);
        }
    }
}

fn set_fullscreen(app: &App, on: bool) {
    if on == app.fullscreen.borrow().is_some() {
        return;
    }
    unsafe {
        if on {
            let mut placement = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
            let _ = GetWindowPlacement(app.hwnd, &mut placement);
            let style = GetWindowLongPtrW(app.hwnd, GWL_STYLE);
            *app.fullscreen.borrow_mut() = Some(Saved { style, placement });
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let _ = GetMonitorInfoW(MonitorFromWindow(app.hwnd, MONITOR_DEFAULTTONEAREST), &mut info);
            let m = info.rcMonitor;
            SetWindowLongPtrW(app.hwnd, GWL_STYLE, style & !(WS_OVERLAPPEDWINDOW.0 as isize));
            let _ = SetWindowPos(app.hwnd, Some(HWND_TOP), m.left, m.top, m.right - m.left, m.bottom - m.top, SWP_FRAMECHANGED | SWP_NOOWNERZORDER);
        } else if let Some(saved) = app.fullscreen.borrow_mut().take() {
            SetWindowLongPtrW(app.hwnd, GWL_STYLE, saved.style);
            let _ = SetWindowPlacement(app.hwnd, &saved.placement);
            let _ = SetWindowPos(app.hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER);
        }
    }
}

// ---- the web view ----

fn create_webview(app: &Rc<App>) -> webview2_com::Result<()> {
    let user_data = sys::wide_path(&crate::common::home().join("WebView2"));
    let options = CoreWebView2EnvironmentOptions::default();
    unsafe {
        options.set_additional_browser_arguments(format!("{BROWSER_ARGS} {}", Settings::get("extraBrowserArgs").unwrap_or_default()).trim().to_string());
    }
    let options: ICoreWebView2EnvironmentOptions = options.into();

    let (tx, rx) = mpsc::channel();
    CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), PCWSTR(user_data.as_ptr()), options.as_raw(), handler.as_raw())
                .ok()
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |error, environment| {
            error?;
            tx.send(environment.ok_or_else(|| windows::core::Error::from(E_POINTER))).expect("send");
            Ok(())
        }),
    )?;
    let environment = rx.recv().map_err(|_| webview2_com::Error::SendError)??;

    let (tx, rx) = mpsc::channel();
    let hwnd = app.hwnd;
    CreateCoreWebView2ControllerCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe { environment.CreateCoreWebView2Controller(hwnd, &handler).map_err(webview2_com::Error::WindowsError) }),
        Box::new(move |error, controller| {
            error?;
            tx.send(controller.ok_or_else(|| windows::core::Error::from(E_POINTER))).expect("send");
            Ok(())
        }),
    )?;
    let controller = rx.recv().map_err(|_| webview2_com::Error::SendError)??;

    unsafe {
        if let Ok(c2) = controller.cast::<ICoreWebView2Controller2>() {
            let _ = c2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 255, R: 0, G: 0, B: 0 }); // no white flash
        }
        let _ = controller.SetIsVisible(true);
        let webview = controller.CoreWebView2()?;
        configure(&webview)?;
        *app.controller.borrow_mut() = Some(controller);
        *app.webview.borrow_mut() = Some(webview);
    }
    Ok(())
}

fn configure(webview: &ICoreWebView2) -> windows::core::Result<()> {
    unsafe {
        let settings = webview.Settings()?;
        settings.SetAreDevToolsEnabled(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        if let Ok(s) = settings.cast::<ICoreWebView2Settings4>() {
            let _ = s.SetIsPasswordAutosaveEnabled(false);
            let _ = s.SetIsGeneralAutofillEnabled(false);
        }
        if let Ok(s) = settings.cast::<ICoreWebView2Settings5>() {
            let _ = s.SetIsPinchZoomEnabled(false);
        }
        if let Ok(s) = settings.cast::<ICoreWebView2Settings6>() {
            let _ = s.SetIsSwipeNavigationEnabled(false);
        }
        if let Ok(w) = webview.cast::<ICoreWebView2_13>() {
            if let Ok(profile) = w.Profile() {
                let _ = profile.SetPreferredColorScheme(COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK);
            }
        }
        set_user_agent(webview);

        let mut token = 0i64;
        webview.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut ok = BOOL::default();
                args.IsSuccess(&mut ok)?;
                if ok.as_bool() {
                    return Ok(());
                }
                let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                args.WebErrorStatus(&mut status)?;
                if [
                    COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                    COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
                    COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
                    COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
                    COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
                    COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE,
                    COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT,
                ]
                .contains(&status)
                {
                    on_ui(|| {
                        if let Some(app) = app() {
                            show_offline(&app);
                        }
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;

        webview.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                args.SetHandled(true)?;
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                // Tuno pages open in the window, everything else in the browser.
                on_ui(move || {
                    if let Some(app) = app() {
                        let server = app.server.borrow().clone().unwrap_or_default();
                        if same_site(&uri, &server) {
                            navigate_raw(&app, &uri);
                        } else {
                            sys::open_external(&uri);
                        }
                    }
                });
                Ok(())
            })),
            &mut token,
        )?;

        webview.add_DocumentTitleChanged(
            &DocumentTitleChangedEventHandler::create(Box::new(|sender, _| {
                let Some(sender) = sender else { return Ok(()) };
                let mut title = PWSTR::null();
                sender.DocumentTitle(&mut title)?;
                let title = take_pwstr(title);
                let shown = if title.trim().is_empty() || title.starts_with("data:") || title == "about:blank" { "Tuno".to_string() } else { title };
                if let Some(app) = app() {
                    let _ = SetWindowTextW(app.hwnd, &HSTRING::from(shown));
                }
                Ok(())
            })),
            &mut token,
        )?;

        if let Ok(w) = webview.cast::<ICoreWebView2>() {
            w.add_ContainsFullScreenElementChanged(
                &ContainsFullScreenElementChangedEventHandler::create(Box::new(|sender, _| {
                    let Some(sender) = sender else { return Ok(()) };
                    let mut full = BOOL::default();
                    sender.ContainsFullScreenElement(&mut full)?;
                    let on = full.as_bool();
                    on_ui(move || {
                        if let Some(app) = app() {
                            set_fullscreen(&app, on);
                        }
                    });
                    Ok(())
                })),
                &mut token,
            )?;
        }

        webview.add_ProcessFailed(
            &ProcessFailedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                args.ProcessFailedKind(&mut kind)?;
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                    on_ui(|| {
                        if let Some(app) = app() {
                            sys::message(app.hwnd, "The web view stopped unexpectedly. Open Tuno again to continue.", MB_OK | MB_ICONWARNING);
                            let _ = PostMessageW(Some(app.hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
                        }
                    });
                } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                {
                    on_ui(|| {
                        if let Some(w) = app().and_then(|a| a.webview.borrow().clone()) {
                            let _ = w.Reload();
                        }
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;

        webview.add_WebMessageReceived(
            &WebMessageReceivedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut json = PWSTR::null();
                args.WebMessageAsJson(&mut json)?;
                let json = take_pwstr(json);
                on_ui(move || {
                    if let (Some(app), Some(message)) = (app(), parse_message(&json)) {
                        on_message(&app, message);
                    }
                });
                Ok(())
            })),
            &mut token,
        )?;

        // F11 toggles fullscreen (WebView2 keeps keyboard focus, so the page passes the key on).
        let script = HSTRING::from(
            "addEventListener('keydown',function(e){if(e.key==='F11'){e.preventDefault();chrome.webview.postMessage('fullscreen');}},true);",
        );
        webview.AddScriptToExecuteOnDocumentCreated(&script, None)?;
    }
    Ok(())
}

/// The web page reads this to show the Windows controls in Settings ("TunoWindows/1.2.0", plus "TunoLocal" on this PC).
fn set_user_agent(webview: &ICoreWebView2) {
    unsafe {
        let Ok(settings) = webview.Settings().and_then(|s| s.cast::<ICoreWebView2Settings2>()) else { return };
        let mut ua = PWSTR::null();
        if settings.UserAgent(&mut ua).is_err() {
            return;
        }
        let base: String = take_pwstr(ua).split(" TunoWindows/").next().unwrap_or_default().to_string();
        let local = if local_mode() { " TunoLocal" } else { "" };
        let _ = settings.SetUserAgent(&HSTRING::from(format!("{base} TunoWindows/{VERSION}{local}")));
    }
}

fn webview(app: &App) -> Option<ICoreWebView2> {
    app.webview.borrow().clone()
}

fn show_page(app: &App, html: String, showing: Showing) {
    app.showing.set(showing);
    if let Some(w) = webview(app) {
        unsafe {
            let _ = w.NavigateToString(&HSTRING::from(html));
        }
    }
}

fn navigate_raw(app: &App, url: &str) {
    if let Some(w) = webview(app) {
        if unsafe { w.Navigate(&HSTRING::from(url)) }.is_err() {
            show_offline(app);
        }
    }
}

fn navigate_home(app: &App) {
    let Some(server) = app.server.borrow().clone() else { return };
    app.showing.set(Showing::Tuno);
    navigate_raw(app, &server);
}

fn show_offline(app: &App) {
    let server = app.server.borrow().clone().unwrap_or_default();
    show_page(app, pages::offline(&server, "PC"), Showing::Offline);
}

/// Decides what to show: the first-run question, the server form, the engine on this PC, or your server.
fn begin(app: &App) {
    if Settings::get("mode").is_none() {
        show_page(app, pages::choose_mode(), Showing::Setup);
    } else if local_mode() {
        start_local(app);
    } else {
        match Settings::server() {
            Some(server) => {
                *app.server.borrow_mut() = Some(server);
                navigate_home(app);
            }
            None => show_page(app, pages::ask_server(DEFAULT_SERVER, "", false), Showing::Setup),
        }
    }
}

fn change_server(app: &App) {
    let current = if local_mode() { None } else { Settings::server() };
    let can_cancel = app.server.borrow().is_some();
    show_page(app, pages::ask_server(current.as_deref().unwrap_or(DEFAULT_SERVER), "", can_cancel), Showing::Setup);
}

/// Starts the engine on this PC (off the window's thread), then opens it signed in as the owner.
fn start_local(app: &App) {
    show_page(app, pages::starting(), Showing::Setup);
    if let Some(w) = webview(app) {
        set_user_agent(&w);
    }
    thread::spawn(|| {
        let result = local::start();
        on_ui(move || {
            let Some(app) = self::app() else { return };
            match result {
                Ok(session) => {
                    if let Some(w) = webview(&app) {
                        set_session_cookie(&w, &session.cookie);
                    }
                    *app.server.borrow_mut() = Some(session.url);
                    navigate_home(&app);
                }
                Err(message) => show_page(&app, pages::problem(&message), Showing::Setup),
            }
        });
    });
}

/// The page talks to the engine as the owner, so the session cookie is handed to the page at start.
fn set_session_cookie(webview: &ICoreWebView2, value: &str) {
    unsafe {
        let Ok(manager) = webview.cast::<ICoreWebView2_2>().and_then(|w| w.CookieManager()) else { return };
        if let Ok(cookie) = manager.CreateCookie(&HSTRING::from("tuno_session"), &HSTRING::from(value), &HSTRING::from("127.0.0.1"), &HSTRING::from("/")) {
            let _ = cookie.SetIsHttpOnly(true);
            let _ = manager.AddOrUpdateCookie(&cookie);
        }
    }
}

// ---- messages from the page ----

fn on_message(app: &App, message: Incoming) {
    match message {
        Incoming::Text(text) => match text.as_str() {
            "change-server" => change_server(app),
            "retry" => begin(app),
            "fullscreen" => {
                let on = app.fullscreen.borrow().is_none();
                set_fullscreen(app, on);
            }
            _ => {}
        },
        Incoming::Message(m) => match m.kind.as_str() {
            "check-update" => start_update_check(app, false, true),
            "install-update" => {
                if app.pending.get().is_some() {
                    restart_into_update(app);
                } else {
                    post_status(app, current_state(app), None, "Nothing is ready to install.");
                }
            }
            "set-auto" => {
                Settings::set("autoUpdate", Some(if m.on { "1" } else { "0" }));
                sys::set_menu_check(app.hwnd, CMD_AUTO_UPDATE, m.on);
                post_status(app, current_state(app), None, "");
            }
            "get-status" => post_status(app, current_state(app), None, ""),
            "now-playing" => now_playing(app, &m),
            "set-discord" => {
                Settings::set("discord", Some(if m.on { "1" } else { "0" }));
                if !m.on {
                    app.discord.clear();
                }
                post_status(app, current_state(app), None, "");
            }
            "setup" => setup(app, &m),
            "setup-cancel" => {
                if app.server.borrow().is_some() {
                    navigate_home(app);
                }
            }
            _ => {}
        },
    }
}

/// An answer from the setup page.
fn setup(app: &App, m: &PageMessage) {
    if m.mode == "local" {
        Settings::set("mode", Some("local"));
        refresh_menu(app.hwnd);
        start_local(app);
        return;
    }
    if m.server.trim().is_empty() {
        show_page(app, pages::ask_server(DEFAULT_SERVER, "", false), Showing::Setup);
        return;
    }
    let Some(server) = normalize_server(&m.server) else {
        let cancel = app.server.borrow().is_some();
        show_page(app, pages::ask_server(&m.server, "That doesn't look like a web address.", cancel), Showing::Setup);
        return;
    };
    let was_local = local_mode();
    Settings::set("server", Some(&server));
    Settings::set("mode", Some("server"));
    if was_local {
        local::stop();
        refresh_menu(app.hwnd);
        if let Some(w) = webview(app) {
            set_user_agent(&w);
        }
    }
    *app.server.borrow_mut() = Some(server);
    navigate_home(app);
}

/// The page reports the song and whether it's playing; Discord shows it while it plays.
fn now_playing(app: &App, m: &PageMessage) {
    if !Settings::discord() || !m.playing || m.title.is_empty() {
        app.discord.clear();
    } else {
        app.discord.show(&m.title, &m.artist, m.position, m.duration);
    }
}

/// Tells the page what the updater is doing (Settings → Updates) and the app's switches (Settings → This PC).
fn post_status(app: &App, state: &str, found: Option<Version>, message: &str) {
    let version = found.or(app.pending.get()).map(|v| v.to_string());
    let json = serde_json::json!({
        "type": "update-status",
        "state": state,
        "auto": auto_update(),
        "version": version,
        "message": message,
        "local": local_mode(),
        "discord": Settings::discord(),
    });
    if let Some(w) = webview(app) {
        unsafe {
            let _ = w.PostWebMessageAsJson(&HSTRING::from(json.to_string()));
        }
    }
}

fn current_state(app: &App) -> &'static str {
    if app.checking.get() {
        "checking"
    } else if app.pending.get().is_some() {
        "ready"
    } else {
        "idle"
    }
}

// ---- updates, and putting a hidden player to sleep ----

/// Checks for a newer Tuno. From the page's Updates section the result goes back to the page, not to a dialog.
fn start_update_check(app: &App, manual: bool, from_web: bool) {
    if app.checking.get() {
        if from_web {
            post_status(app, current_state(app), None, "Already checking.");
        }
        return;
    }
    let target = if local_mode() { Some(UPDATE_FEED.to_string()) } else { app.server.borrow().clone().or_else(Settings::server) };
    let Some(target) = target else {
        if from_web {
            post_status(app, current_state(app), None, "Connect to a server first.");
        }
        return;
    };
    app.checking.set(true);
    if from_web {
        post_status(app, "checking", None, "");
    }
    thread::spawn(move || {
        let result = updater::check_and_download(&target);
        on_ui(move || {
            let Some(app) = self::app() else { return };
            app.checking.set(false);
            // A failed check (server asleep, VPN off) is retried in half an hour; a good one in six hours.
            let wait = if result.answered { Duration::from_secs(6 * 3600) } else { Duration::from_secs(30 * 60) };
            app.next_check.set(Instant::now() + wait);
            if let Some(v) = result.ready {
                app.pending.set(Some(v));
            }
            if from_web {
                let state = if result.ready.is_some() {
                    "ready"
                } else if result.message.contains("latest version") {
                    "uptodate"
                } else {
                    "error"
                };
                post_status(&app, state, result.ready, &result.message);
            } else if manual {
                match result.ready {
                    Some(v) => {
                        let text = format!("Tuno {v} is ready. Restart now to install it?");
                        if sys::message(app.hwnd, &text, MB_YESNO | MB_ICONINFORMATION) == IDYES {
                            restart_into_update(&app);
                        }
                    }
                    None => {
                        sys::message(app.hwnd, &result.message, MB_OK | MB_ICONINFORMATION);
                    }
                }
            }
        });
    });
}

fn restart_into_update(app: &App) {
    unsafe {
        let _ = KillTimer(Some(app.hwnd), TICK);
    }
    if updater::try_apply_pending() {
        updater::restart();
        unsafe {
            let _ = PostMessageW(Some(app.hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    } else {
        app.pending.set(None);
        unsafe {
            SetTimer(Some(app.hwnd), TICK, 30_000, None);
        }
    }
}

fn playing_audio(app: &App) -> bool {
    let mut playing = BOOL::default();
    webview(app)
        .and_then(|w| w.cast::<ICoreWebView2_8>().ok())
        .map(|w| unsafe { w.IsDocumentPlayingAudio(&mut playing).is_ok() && playing.as_bool() })
        .unwrap_or(false)
}

fn on_tick(app: &App) {
    if !app.trimmed.get() {
        app.trimmed.set(true);
        sys::trim_working_set();
    }
    let playing = playing_audio(app);
    if auto_update() && !app.checking.get() && Instant::now() >= app.next_check.get() {
        start_update_check(app, false, false);
    }
    // An update installs without interrupting music: once nothing has played for a minute, restart into it.
    if app.pending.get().is_some() && auto_update() {
        app.idle_ticks.set(if playing { 0 } else { app.idle_ticks.get() + 1 });
        if app.idle_ticks.get() >= 2 {
            restart_into_update(app);
            return;
        }
    }
    // A minimized window that isn't playing doesn't need a running page at all.
    if unsafe { IsIconic(app.hwnd).as_bool() } && !playing {
        try_suspend(app);
    }
}

fn set_memory_target(app: &App, low: bool) {
    if let Some(w) = webview(app).and_then(|w| w.cast::<ICoreWebView2_19>().ok()) {
        let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        unsafe {
            let _ = w.SetMemoryUsageTargetLevel(level);
        }
    }
}

fn try_suspend(app: &App) {
    let (Some(controller), Some(w3)) = (app.controller.borrow().clone(), webview(app).and_then(|w| w.cast::<ICoreWebView2_3>().ok())) else {
        return;
    };
    unsafe {
        let mut suspended = BOOL::default();
        if w3.IsSuspended(&mut suspended).is_ok() && suspended.as_bool() {
            return;
        }
        // WebView2 can only sleep while hidden.
        let _ = controller.SetIsVisible(false);
        let again = controller.clone();
        let handler = TrySuspendCompletedHandler::create(Box::new(move |error, ok| {
            if error.is_err() || !ok {
                let _ = again.SetIsVisible(true);
            }
            Ok(())
        }));
        if w3.TrySuspend(&handler).is_err() {
            let _ = controller.SetIsVisible(true);
        }
    }
}

fn resume_web(app: &App) {
    let Some(controller) = app.controller.borrow().clone() else { return };
    unsafe {
        let _ = controller.SetIsVisible(true);
        if let Some(w3) = webview(app).and_then(|w| w.cast::<ICoreWebView2_3>().ok()) {
            let mut suspended = BOOL::default();
            if w3.IsSuspended(&mut suspended).is_ok() && suspended.as_bool() {
                let _ = w3.Resume();
            }
        }
    }
}

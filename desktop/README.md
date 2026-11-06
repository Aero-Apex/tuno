# Tuno desktop app (Windows and macOS)

One Rust program builds both desktop apps: a small native window around your Tuno server's web app. Windows uses
the WebView2 runtime that ships with Windows; macOS uses the system's WebKit. Neither bundles a browser.

Build with [`windows/build.ps1`](../windows/build.ps1) and [`mac/build.ps1`](../mac/build.ps1) (or `mac/build.sh`).
What each app does is described in [`windows/README.md`](../windows/README.md) and [`mac/README.md`](../mac/README.md).

| File | What it does |
| --- | --- |
| `src/common.rs` | Settings (`settings.txt`), server addresses, versions, and the messages the web page sends |
| `src/pages.rs` | The app's own pages: first-run setup, "can't reach your server", "starting Tuno" |
| `src/discord.rs` | The Discord listening status, over Discord's local pipe (Windows) or socket (macOS) |
| `src/win/mod.rs` | The Windows window, WebView2, the setup flow, updates, fullscreen and sleeping while hidden |
| `src/win/updater.rs` | Signed self-updates (the same checks and files as the earlier C# app) |
| `src/win/local.rs` | The on-PC edition: starts the bundled engine, the device lock and the DPAPI-protected secret |
| `src/win/sys.rs` | Small Win32 helpers |
| `src/mac/mod.rs` | The Mac window, menu bar, web view, downloads and the messages to and from the page |
| `src/mac/objc.rs` | A minimal Objective-C runtime bridge, opened at start so nothing from Apple is linked |
| `pack/` | Joins the two Mac builds into a universal `Tuno.app` and zips it (runs on any OS) |

The web page finds out it's in an app from the user agent (`TunoWindows/<version>` or `TunoMac/<version>`) and talks
to it through `chrome.webview` (Windows) or `webkit.messageHandlers.tuno` (macOS); see
[`web/src/lib/windows.ts`](../web/src/lib/windows.ts).

Tests: `cargo test --release` in this folder (add `TUNO_TEST_EXE` and `TUNO_TEST_SIG` to check a real published
update's signature).

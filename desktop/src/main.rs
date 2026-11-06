// Tuno for Windows and macOS: a small native window around your Tuno server's web app.
// Windows uses the WebView2 runtime that ships with Windows; macOS uses the system's WebKit. No bundled browser.
#![cfg_attr(windows, windows_subsystem = "windows")]

mod common;
mod discord;
mod pages;

#[cfg(windows)]
mod win;

#[cfg(target_os = "macos")]
mod mac;

fn main() {
    #[cfg(windows)]
    win::run();
    #[cfg(target_os = "macos")]
    mac::run();
    #[cfg(not(any(windows, target_os = "macos")))]
    eprintln!("Tuno's desktop app runs on Windows and macOS. Open your Tuno server in a browser instead.");
}

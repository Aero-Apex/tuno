// Small Win32 helpers.
use std::{ffi::c_void, os::windows::ffi::OsStrExt, path::Path};

use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, HWND},
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE},
        Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO},
        System::Threading::{CreateMutexW, GetCurrentProcess, SetProcessWorkingSetSize},
        UI::{
            Shell::{SetCurrentProcessExplicitAppUserModelID, ShellExecuteW},
            WindowsAndMessaging::*,
        },
    },
};

use crate::common::Version;

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn wide_path(p: &Path) -> Vec<u16> {
    p.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

pub fn message(owner: HWND, text: &str, style: MESSAGEBOX_STYLE) -> MESSAGEBOX_RESULT {
    unsafe { MessageBoxW(Some(owner), &HSTRING::from(text), &HSTRING::from("Tuno"), style) }
}

pub fn open_external(url: &str) {
    if !crate::common::is_external_link(url) {
        return;
    }
    unsafe {
        ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(url), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
    }
}

pub fn set_app_id() {
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from("Tuno.Desktop"));
    }
}

/// Dark title bar to match the app (Windows 10 20H1+; the caption colour needs Windows 11, older builds ignore both).
pub fn dark_title_bar(hwnd: HWND) {
    let set = |attr: i32, value: u32| unsafe {
        let _ = DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE(attr), &value as *const u32 as *const c_void, 4);
    };
    set(20, 1); // DWMWA_USE_IMMERSIVE_DARK_MODE
    set(19, 1); // the same, on Windows 10 before 20H1
    set(35, 0x000000); // DWMWA_CAPTION_COLOR: black, like the app's top bar
    set(36, 0xFFFFFF); // DWMWA_TEXT_COLOR
}

pub fn add_system_menu_items(hwnd: HWND, items: &[(u32, String)]) {
    unsafe {
        let menu = GetSystemMenu(hwnd, false);
        if menu.is_invalid() {
            return;
        }
        let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
        for (id, text) in items {
            let _ = AppendMenuW(menu, MF_STRING, *id as usize, &HSTRING::from(text.as_str()));
        }
    }
}

pub fn set_menu_check(hwnd: HWND, id: u32, on: bool) {
    unsafe {
        let menu = GetSystemMenu(hwnd, false);
        if !menu.is_invalid() {
            CheckMenuItem(menu, id, (MF_BYCOMMAND | if on { MF_CHECKED } else { MF_UNCHECKED }).0);
        }
    }
}

/// Hands unused pages back to Windows (Task Manager then shows what Tuno really needs).
pub fn trim_working_set() {
    unsafe {
        let _ = SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
    }
}

/// The single-instance lock. Returns None when another Tuno already holds it.
pub struct InstanceLock(HANDLE);

impl InstanceLock {
    pub fn take() -> Option<InstanceLock> {
        // A copy with its own TUNO_HOME (a portable copy) has its own profile, so it may run alongside the installed one.
        let mut name = String::from("Tuno.Desktop.SingleInstance");
        if std::env::var_os("TUNO_HOME").is_some() {
            use sha2::{Digest, Sha256};
            let hash = Sha256::digest(crate::common::home().to_string_lossy().to_lowercase().as_bytes());
            name += &format!(".{:02x}{:02x}{:02x}{:02x}", hash[0], hash[1], hash[2], hash[3]);
        }
        unsafe {
            let handle = CreateMutexW(None, true, &HSTRING::from(name)).ok()?;
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = CloseHandle(handle);
                return None;
            }
            Some(InstanceLock(handle))
        }
    }
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

pub const WINDOW_CLASS: &str = "TunoWindow";

/// Brings the Tuno that's already running to the front.
pub fn focus_running_instance() {
    unsafe {
        if let Ok(hwnd) = FindWindowW(&HSTRING::from(WINDOW_CLASS), PCWSTR::null()) {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

/// The version inside an exe (its version resource), as the updater checks it.
pub fn file_version(path: &Path) -> Option<Version> {
    unsafe {
        let name = wide_path(path);
        let size = GetFileVersionInfoSizeW(PCWSTR(name.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(PCWSTR(name.as_ptr()), None, size, data.as_mut_ptr() as *mut c_void).ok()?;
        let mut info: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let root = wide("\\");
        if !VerQueryValueW(data.as_ptr() as *const c_void, PCWSTR(root.as_ptr()), &mut info, &mut len).as_bool() || info.is_null() {
            return None;
        }
        let fixed = &*(info as *const VS_FIXEDFILEINFO);
        Some(Version(fixed.dwFileVersionMS >> 16, fixed.dwFileVersionMS & 0xFFFF, fixed.dwFileVersionLS >> 16))
    }
}

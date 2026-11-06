// Sets TUNO_VERSION from windows/VERSION or mac/VERSION, and on Windows embeds the icon, the manifest and the
// version resource (the self-updater checks the version inside a downloaded Tuno.exe before installing it).
use std::{env, fs, path::PathBuf};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let version_file = root.join(if os == "macos" { "mac/VERSION" } else { "windows/VERSION" });
    println!("cargo:rerun-if-changed={}", version_file.display());
    let version = fs::read_to_string(&version_file).expect("VERSION file").trim().to_string();
    println!("cargo:rustc-env=TUNO_VERSION={version}");

    if os == "windows" {
        windows_resources(&root, &version);
    }
}

#[cfg(windows)]
fn windows_resources(root: &std::path::Path, version: &str) {
    let parts: Vec<u32> = version.split('.').map(|p| p.parse().unwrap_or(0)).chain([0, 0, 0]).take(3).collect();
    let (a, b, c) = (parts[0], parts[1], parts[2]);
    let win = root.join("windows");
    let path = |name: &str| win.join(name).display().to_string().replace('\\', "\\\\");
    let rc = format!(
        r#"#pragma code_page(65001)
1 ICON "{icon}"
1 24 "{manifest}"
1 VERSIONINFO
FILEVERSION {a},{b},{c},0
PRODUCTVERSION {a},{b},{c},0
FILEOS 0x40004
FILETYPE 0x1
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
      VALUE "CompanyName", "Tuno"
      VALUE "FileDescription", "Tuno for Windows"
      VALUE "FileVersion", "{version}"
      VALUE "InternalName", "Tuno"
      VALUE "OriginalFilename", "Tuno.exe"
      VALUE "ProductName", "Tuno"
      VALUE "ProductVersion", "{version}"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
"#,
        icon = path("tuno.ico"),
        manifest = path("app.manifest"),
    );
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("tuno.rc");
    fs::write(&out, rc).unwrap();
    println!("cargo:rerun-if-changed={}", win.join("tuno.ico").display());
    println!("cargo:rerun-if-changed={}", win.join("app.manifest").display());
    embed_resource::compile(&out, embed_resource::NONE).manifest_required().unwrap();
}

#[cfg(not(windows))]
fn windows_resources(_root: &std::path::Path, _version: &str) {}

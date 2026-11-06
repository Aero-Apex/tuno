# Builds Tuno for macOS on Windows (one universal app for Apple Silicon and Intel) and zips it. No Mac needed:
# the app opens AppKit and WebKit when it starts, so nothing from Apple is linked, and Zig links the Mac binaries.
# Needs Rust (rustup.rs) and, once:
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin
#   python -m pip install --user ziglang cargo-zigbuild
#   Usage:  .\mac\build.ps1   ->  mac\dist\Tuno-<version>-mac.zip
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$desktop = Join-Path $root 'desktop'
$version = (Get-Content (Join-Path $here 'VERSION') -Raw).Trim()

# pip puts cargo-zigbuild in the user's Python Scripts folder, which often isn't on PATH.
$scripts = python -c "import sysconfig; print(sysconfig.get_path('scripts', 'nt_user'))"
if ($scripts -and (Test-Path $scripts)) { $env:PATH = "$env:PATH;$scripts" }
# A cache folder of our own: with the Microsoft Store Python, Zig can't see cargo-zigbuild's default one.
$env:CARGO_ZIGBUILD_CACHE_DIR = Join-Path $desktop 'target\zigbuild-cache'
New-Item -ItemType Directory -Force $env:CARGO_ZIGBUILD_CACHE_DIR | Out-Null

foreach ($target in 'aarch64-apple-darwin', 'x86_64-apple-darwin') {
  Write-Host "==> Compiling Tuno $version for $target" -ForegroundColor Cyan
  cargo zigbuild --release --target $target --manifest-path (Join-Path $desktop 'Cargo.toml')
  if ($LASTEXITCODE -ne 0) { throw "build failed for $target" }
}

Write-Host '==> Packing Tuno.app' -ForegroundColor Cyan
cargo run --release --manifest-path (Join-Path $desktop 'pack\Cargo.toml') -- $version `
  (Join-Path $desktop 'target\aarch64-apple-darwin\release\tuno') `
  (Join-Path $desktop 'target\x86_64-apple-darwin\release\tuno') `
  (Join-Path $root 'web\public\icon-512.png') (Join-Path $here 'Info.plist') (Join-Path $here 'dist')
if ($LASTEXITCODE -ne 0) { throw 'packing failed' }

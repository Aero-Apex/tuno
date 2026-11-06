# Builds Tuno.exe from the Rust app in ..\desktop: one small file, no installer, no runtime to install
# (WebView2's loader is linked in). Needs Rust (rustup.rs) with the MSVC toolchain, which uses Visual Studio's
# C++ build tools and the Windows SDK.
#   Usage:  .\build.ps1            ->  dist\Tuno.exe
param(
  [string]$Out = (Join-Path $PSScriptRoot 'dist')
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$desktop = Join-Path (Split-Path $here -Parent) 'desktop'
$version = (Get-Content (Join-Path $here 'VERSION') -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "VERSION must look like 1.2.3 (got '$version')" }

Write-Host "==> Compiling Tuno $version" -ForegroundColor Cyan
cargo build --release --manifest-path (Join-Path $desktop 'Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }

New-Item -ItemType Directory -Force $Out | Out-Null
$exe = Join-Path $Out 'Tuno.exe'
Copy-Item (Join-Path $desktop 'target\release\tuno.exe') $exe -Force
$built = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).FileVersion
if ($built -ne $version) { throw "Tuno.exe says it is $built, but VERSION is $version" }
Write-Host ("==> Built Tuno {0}: {1} ({2:N0} KB)" -f $version, $exe, ((Get-Item $exe).Length / 1KB)) -ForegroundColor Green
exit 0

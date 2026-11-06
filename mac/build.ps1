# Builds Tuno for macOS on Windows (one universal app for Apple Silicon and Intel) and zips it. Needs Go only:
# the app talks to AppKit and WebKit without a C compiler, so no Mac is needed to build it.
#   Usage:  .\mac\build.ps1   ->  mac\dist\Tuno-<version>-mac.zip
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$version = (Get-Content VERSION -Raw).Trim()

if (Test-Path obj) { Remove-Item obj -Recurse -Force }
New-Item -ItemType Directory -Force obj, dist | Out-Null
$env:CGO_ENABLED = '0'
$env:GOOS = 'darwin'
try {
  foreach ($arch in 'arm64', 'amd64') {
    Write-Host "==> Compiling Tuno $version for $arch" -ForegroundColor Cyan
    $env:GOARCH = $arch
    go build -trimpath -ldflags '-s -w' -o "obj/tuno-$arch" ./app
    if ($LASTEXITCODE -ne 0) { throw "go build failed for $arch" }
  }
} finally {
  Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
}

Write-Host '==> Packing Tuno.app' -ForegroundColor Cyan
go run ./pack -version $version -arm64 obj/tuno-arm64 -amd64 obj/tuno-amd64 -icon ../web/public/icon-512.png -out dist
if ($LASTEXITCODE -ne 0) { throw 'packing failed' }

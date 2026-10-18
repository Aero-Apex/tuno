# Builds the on-PC edition: a folder with Tuno.exe and an engine (Node, the Tuno server, yt-dlp, ffmpeg and the web app),
# so Tuno runs on this PC without any server. Also writes the zip that goes on the release page.
#   Usage:  .\build-local.ps1          ->  dist\local\Tuno  and  dist\Tuno-<version>-on-this-PC.zip
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$version = (Get-Content (Join-Path $here 'VERSION') -Raw).Trim()

Write-Host '==> Building the Windows app' -ForegroundColor Cyan
& (Join-Path $here 'build.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Windows app build failed' }

Write-Host '==> Building the server and the web app' -ForegroundColor Cyan
Push-Location $root
try {
  npm run build -w web
  if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
  npm run build -w server
  if ($LASTEXITCODE -ne 0) { throw 'server build failed' }
} finally {
  Pop-Location
}

$out = Join-Path $here 'dist\local'
$app = Join-Path $out 'Tuno'
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
$engine = Join-Path $app 'engine'
New-Item -ItemType Directory -Force (Join-Path $engine 'server'), (Join-Path $engine 'web') | Out-Null
Copy-Item (Join-Path $here 'dist\Tuno.exe') $app

Write-Host '==> Adding Node.js' -ForegroundColor Cyan
$node = (Get-Command node).Source
Copy-Item $node (Join-Path $engine 'node.exe')

Write-Host '==> Adding ffmpeg' -ForegroundColor Cyan
$ffmpegLink = (Get-Command ffmpeg).Source
$ffmpeg = (Get-Item $ffmpegLink).Target
if ($ffmpeg -is [array]) { $ffmpeg = $ffmpeg[0] }
if (-not $ffmpeg) { $ffmpeg = $ffmpegLink }
Copy-Item $ffmpeg (Join-Path $engine 'ffmpeg.exe')

Write-Host '==> Downloading yt-dlp (standalone)' -ForegroundColor Cyan
Invoke-WebRequest -UseBasicParsing 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile (Join-Path $engine 'yt-dlp.exe')

Write-Host '==> Adding the Tuno server' -ForegroundColor Cyan
Copy-Item (Join-Path $root 'server\dist') (Join-Path $engine 'server\dist') -Recurse
Copy-Item (Join-Path $root 'server\package.json') (Join-Path $engine 'server\package.json')
Push-Location (Join-Path $engine 'server')
try {
  # Production dependencies only; better-sqlite3 comes with its prebuilt Windows binary.
  npm install --omit=dev --no-audit --no-fund --package-lock=false
  if ($LASTEXITCODE -ne 0) { throw 'installing the server dependencies failed' }
} finally {
  Pop-Location
}

Write-Host '==> Adding the web app' -ForegroundColor Cyan
Copy-Item (Join-Path $root 'web\dist') (Join-Path $engine 'web\dist') -Recurse
Set-Content -Path (Join-Path $engine 'version.txt') -Value $version -Encoding ascii

Write-Host '==> Zipping' -ForegroundColor Cyan
$zip = Join-Path $here "dist\Tuno-$version-on-this-PC.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $app -DestinationPath $zip
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ("==> Built the on-PC edition {0}: {1} ({2} MB)" -f $version, $zip, $mb) -ForegroundColor Green

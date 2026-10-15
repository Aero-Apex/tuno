# Deploys Tuno to the home server with Docker.
#   Usage:  .\deploy.ps1                 (defaults below)
#           .\deploy.ps1 -Server me@1.2.3.4 -Dir tuno
# Needs SSH key login to the server (no password prompts) and Docker on the server.
# Layout on the server:  <Dir>/app (code)   <Dir>/data (database, settings)   <Dir>/library (your music)
param(
  [string]$Server = 'serverr@192.168.88.32',
  [string]$Dir = 'tuno'
)
# Docker prints progress on stderr, so we check exit codes instead of using -ErrorAction Stop.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$archive = Join-Path $env:TEMP 'tuno-deploy.tar.gz'

Write-Host '==> Packing source' -ForegroundColor Cyan
if (Test-Path $archive) { Remove-Item $archive -Force }
tar -czf $archive -C $root `
  --exclude=node_modules --exclude=dist --exclude=data --exclude=library `
  --exclude=server/.env --exclude=.claude --exclude=android --exclude=*.apk --exclude=.git --exclude=*.log `
  package.json package-lock.json Dockerfile docker-compose.yml .dockerignore server web
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }

Write-Host "==> Uploading to $Server" -ForegroundColor Cyan
ssh $Server "mkdir -p $Dir/app $Dir/data $Dir/library"
scp -q $archive "${Server}:$Dir/tuno-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'upload failed' }

Write-Host '==> Building and starting the container (first build takes a few minutes)' -ForegroundColor Cyan
ssh $Server "set -e; cd $Dir; rm -rf app.new; mkdir app.new; tar -xzf tuno-deploy.tar.gz -C app.new; rm tuno-deploy.tar.gz; rm -rf app; mv app.new app; cd app; docker compose up -d --build; docker image prune -f >/dev/null"
if ($LASTEXITCODE -ne 0) { throw 'remote build failed' }

$hostOnly = ($Server -split '@')[-1]
Write-Host "==> Done. Open http://${hostOnly}:7070" -ForegroundColor Green

# Publishes a built app to your Tuno server so installed copies update themselves.
#   .\scripts\publish-update.ps1 -Platform android      # android\app\build\outputs\apk\release\app-release.apk
#   .\scripts\publish-update.ps1 -Platform windows      # windows\dist\Tuno.exe (signed with your update key)
# Needs SSH key login to the server (like deploy.ps1). Use -OutDir to write the files to a local folder instead
# (for a server running on this PC: its <data>\updates folder).
param(
  [Parameter(Mandatory)][ValidateSet('android', 'windows')][string]$Platform,
  [string]$File,
  [string]$Notes = '',
  [string]$Server = 'serverr@192.168.88.32',
  [string]$Dir = 'tuno',
  [string]$OutDir,
  [string]$PrivateKeyPath = (Join-Path $env:USERPROFILE '.tuno\update-signing.key'),
  [string]$VersionCode      # Android only: overrides the code read from the APK (not normally needed)
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $File) {
  $File = if ($Platform -eq 'android') { Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk' } else { Join-Path $root 'windows\dist\Tuno.exe' }
}
if (-not (Test-Path $File)) { throw "Build it first: $File not found" }
$File = (Resolve-Path $File).Path
$bytes = [IO.File]::ReadAllBytes($File)
$sha = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)) -replace '-', '').ToLower()

$manifest = [ordered]@{}
if ($Platform -eq 'android') {
  $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  $aapt = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory | Sort-Object { [version]($_.Name -replace '-.*$', '') } | Select-Object -Last 1 | ForEach-Object { Join-Path $_.FullName 'aapt.exe' }
  $badging = (& $aapt dump badging $File | Select-String "^package:").Line
  if ($badging -notmatch "name='app.tuno' versionCode='(\d+)' versionName='([^']+)'") { throw "That doesn't look like the Tuno APK: $badging" }
  $code = if ($VersionCode) { [int]$VersionCode } else { [int]$Matches[1] }
  $version = $Matches[2]
  $ext = 'apk'
  $manifest.version = $version
  $manifest.versionCode = $code
} else {
  $fv = [version][Diagnostics.FileVersionInfo]::GetVersionInfo($File).FileVersion
  $version = '{0}.{1}.{2}' -f $fv.Major, $fv.Minor, [math]::Max($fv.Build, 0)
  $ext = 'exe'
  if (-not (Test-Path $PrivateKeyPath)) { throw "Signing key not found at $PrivateKeyPath. Run windows\new-signing-key.ps1 first." }
  $key = [Security.Cryptography.CngKey]::Import([Convert]::FromBase64String((Get-Content -Raw $PrivateKeyPath).Trim()), [Security.Cryptography.CngKeyBlobFormat]::EccPrivateBlob)
  $ecdsa = New-Object Security.Cryptography.ECDsaCng($key)
  $signature = [Convert]::ToBase64String($ecdsa.SignData($bytes, [Security.Cryptography.HashAlgorithmName]::SHA256))
  $manifest.version = $version
}
$name = "Tuno-$version.$ext"
$manifest.file = $name
$manifest.sha256 = $sha
$manifest.size = $bytes.Length
if ($Platform -eq 'windows') { $manifest.signature = $signature }
if ($Notes) { $manifest.notes = $Notes }
$json = $manifest | ConvertTo-Json

$tmp = Join-Path $env:TEMP "tuno-publish-$Platform"
New-Item -ItemType Directory -Force $tmp | Out-Null
$jsonFile = Join-Path $tmp "$Platform.json"
[IO.File]::WriteAllText($jsonFile, $json, (New-Object Text.UTF8Encoding $false))

if ($OutDir) {
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  Copy-Item $File (Join-Path $OutDir $name) -Force
  Copy-Item $jsonFile (Join-Path $OutDir "$Platform.json") -Force
  Write-Host "Wrote $name and $Platform.json to $OutDir" -ForegroundColor Green
} else {
  Write-Host "==> Uploading $name to $Server" -ForegroundColor Cyan
  ssh $Server "mkdir -p $Dir/data/updates"
  scp -q $File "${Server}:$Dir/data/updates/$name"
  if ($LASTEXITCODE -ne 0) { throw 'upload failed' }
  scp -q $jsonFile "${Server}:$Dir/data/updates/$Platform.json.tmp"
  if ($LASTEXITCODE -ne 0) { throw 'upload failed' }
  # The manifest goes live last, in one step, so an app never sees it before the file is there. Keep the two newest builds.
  ssh $Server "cd $Dir/data/updates && mv -f $Platform.json.tmp $Platform.json && ls -t Tuno-*.$ext | tail -n +3 | xargs -r rm --"
  if ($LASTEXITCODE -ne 0) { throw 'publishing failed' }
  Write-Host "==> Published $Platform $version (sha256 $($sha.Substring(0, 12))...)" -ForegroundColor Green
}

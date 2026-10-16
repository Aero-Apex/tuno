# Creates the key pair that signs Windows updates (ECDSA P-256). Run it once.
#   - the PRIVATE key stays on this PC (default: %USERPROFILE%\.tuno\update-signing.key). Keep it safe and never put it on the server.
#   - the PUBLIC key goes into windows\update-public.key and is built into Tuno.exe, which refuses updates not signed by it.
# If you lose the private key, apps already installed can't be updated automatically any more (you'd install a new build by hand).
param([string]$PrivateKeyPath = (Join-Path $env:USERPROFILE '.tuno\update-signing.key'))
$ErrorActionPreference = 'Stop'
$public = Join-Path $PSScriptRoot 'update-public.key'
if ((Test-Path $PrivateKeyPath) -or (Test-Path $public)) { throw "A key already exists ($PrivateKeyPath / $public). Delete both first if you really want a new one." }

$p = New-Object Security.Cryptography.CngKeyCreationParameters
$p.ExportPolicy = [Security.Cryptography.CngExportPolicies]::AllowPlaintextExport
$key = [Security.Cryptography.CngKey]::Create([Security.Cryptography.CngAlgorithm]::ECDsaP256, $null, $p)

New-Item -ItemType Directory -Force (Split-Path $PrivateKeyPath) | Out-Null
[Convert]::ToBase64String($key.Export([Security.Cryptography.CngKeyBlobFormat]::EccPrivateBlob)) | Set-Content -NoNewline -Encoding ascii $PrivateKeyPath
[Convert]::ToBase64String($key.Export([Security.Cryptography.CngKeyBlobFormat]::EccPublicBlob)) | Set-Content -NoNewline -Encoding ascii $public
$key.Dispose()
Write-Host "Private key: $PrivateKeyPath  (keep it secret)"
Write-Host "Public key:  $public"

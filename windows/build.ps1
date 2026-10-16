# Builds Tuno.exe: one small file, no installer. Needs the .NET SDK (for its C# compiler) and internet on the first run
# (to fetch Microsoft's WebView2 libraries, which get packed inside the exe).
#   Usage:  .\build.ps1            ->  dist\Tuno.exe
param(
  [string]$Out = (Join-Path $PSScriptRoot 'dist'),
  [string]$Version   # default: the number in the VERSION file
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $Version) { $Version = (Get-Content (Join-Path $here 'VERSION') -Raw).Trim() }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3 (got '$Version')" }
$webview2 = '1.0.2903.40'

# 1) WebView2 libraries from NuGet (cached in .deps)
$deps = Join-Path $here ".deps\webview2-$webview2"
$core = Join-Path $deps 'lib\net462\Microsoft.Web.WebView2.Core.dll'
if (-not (Test-Path $core)) {
  Write-Host "==> Downloading Microsoft.Web.WebView2 $webview2" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force $deps | Out-Null
  $zip = Join-Path $deps 'package.zip'
  Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$webview2/microsoft.web.webview2.$webview2.nupkg" -OutFile $zip
  Expand-Archive $zip -DestinationPath $deps -Force
  Remove-Item $zip
}

# 2) C# compiler from the .NET SDK, framework reference assemblies from Windows itself (.NET Framework 4.8 ships with Windows 10/11)
$sdk = Get-ChildItem "$env:ProgramFiles\dotnet\sdk" -Directory | Sort-Object { [version]($_.Name -replace '-.*$', '') } | Select-Object -Last 1
if (-not $sdk) { throw 'Install the .NET SDK (https://dotnet.microsoft.com/download) to build.' }
$csc = Join-Path $sdk.FullName 'Roslyn\bincore\csc.dll'
$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'

# 3) Pack the libraries (gzip) so they can ride inside the exe
$obj = Join-Path $here 'obj'
New-Item -ItemType Directory -Force $obj, $Out | Out-Null
$info = Join-Path $obj 'AssemblyInfo.cs'
Set-Content -Encoding ascii $info "[assembly: System.Reflection.AssemblyVersion(`"$Version.0`")]`r`n[assembly: System.Reflection.AssemblyFileVersion(`"$Version.0`")]"
function Pack($src, $name) {
  $dst = Join-Path $obj "$name.gz"
  $in = [IO.File]::OpenRead($src); $outFile = [IO.File]::Create($dst)
  $gz = New-Object IO.Compression.GZipStream($outFile, [IO.Compression.CompressionLevel]::Optimal)
  $in.CopyTo($gz); $gz.Dispose(); $outFile.Dispose(); $in.Dispose()
  return $dst
}
$coreGz = Pack $core 'Microsoft.Web.WebView2.Core.dll'
$formsGz = Pack (Join-Path $deps 'lib\net462\Microsoft.Web.WebView2.WinForms.dll') 'Microsoft.Web.WebView2.WinForms.dll'
$loaderGz = Pack (Join-Path $deps 'runtimes\win-x64\native\WebView2Loader.dll') 'WebView2Loader.dll'

if (-not (Test-Path (Join-Path $here 'update-public.key'))) { throw 'Run new-signing-key.ps1 first: the exe needs the public key that checks its updates.' }

# 4) Compile
Write-Host '==> Compiling' -ForegroundColor Cyan
$exe = Join-Path $Out 'Tuno.exe'
$refs = @('mscorlib', 'System', 'System.Core', 'System.Drawing', 'System.Windows.Forms', 'System.Web.Extensions') | ForEach-Object { "/r:$fw\$_.dll" }
& dotnet $csc /nologo /noconfig /nostdlib+ /target:winexe /platform:x64 /optimize+ /debug- /langversion:latest `
  "/out:$exe" "/win32icon:$here\tuno.ico" "/win32manifest:$here\app.manifest" `
  $refs "/r:$core" "/r:$deps\lib\net462\Microsoft.Web.WebView2.WinForms.dll" `
  "/resource:$coreGz,Microsoft.Web.WebView2.Core.dll.gz" `
  "/resource:$formsGz,Microsoft.Web.WebView2.WinForms.dll.gz" `
  "/resource:$loaderGz,WebView2Loader.dll.gz" `
  "/resource:$here\tuno.ico,tuno.ico" `
  "/resource:$here\update-public.key,update-public.key" `
  "$here\Tuno.cs" $info
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
Write-Host ("==> Built Tuno {0}: {1} ({2:N0} KB)" -f $Version, $exe, ((Get-Item $exe).Length / 1KB)) -ForegroundColor Green

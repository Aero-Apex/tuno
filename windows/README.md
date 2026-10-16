# Tuno for Windows

A very small native Windows app for your Tuno server. `Tuno.exe` is about 370 KB: a window that hosts the
**WebView2** runtime already installed with Windows 11 and recent Windows 10 (the same engine as Edge), so there is no
bundled browser, no installer and nothing running in the background.

What it adds over a browser tab:

- its own icon, taskbar entry and dark title bar
- media keys and the Windows media overlay (play/pause, next, previous, cover art) work with Tuno
- remembers the server address, window size and position
- a "Can't reach your server" page that retries by itself and opens the moment the server answers (handy with a VPN)
- while minimized it asks WebView2 to trim its memory (audio keeps playing)
- one window only: starting it again brings the running one to the front
- **updates itself** from your server (see below); the page goes to sleep while the window is minimized and nothing is playing
- the page title shows the song that's playing; `F11` toggles full screen; links to other sites open in your browser

## Use it

Run `Tuno.exe`. The first time it asks for your server address (for example `http://192.168.1.50:7070` or
`https://music.example.com`), then you log in as usual and stay logged in.

- **Change the server:** right-click the title bar (or press `Alt+Space`) and choose *Change server...*
- **Reload:** `F5`
- You can also launch it with an address: `Tuno.exe http://192.168.1.50:7070`
- Settings and the browser profile live in `%LOCALAPPDATA%\Tuno`. Set the `TUNO_HOME` environment variable to keep
  them somewhere else (for a portable copy on a USB stick).

Needs Windows 10 (64-bit) or 11 with .NET Framework 4.8 (built in since Windows 10 May 2019) and the WebView2 Runtime.
If the runtime is missing, Tuno offers to open Microsoft's download page.

## Updates

When Tuno opens (and every 6 hours after) it asks your server for a newer `Tuno.exe`. A new build is downloaded in the background and
installed when nothing has played for a minute, or when you close Tuno. It only trusts builds signed with your private update key:
the checksum, the signature and the version inside the file must all check out. Right-click the title bar for
*Check for updates* and the *Update automatically* switch. Check results are logged in `%LOCALAPPDATA%\Tuno\update.log`.

To release an update: raise the number in `VERSION`, run `build.ps1`, then `..\scripts\publish-update.ps1 -Platform windows`.
Create the key pair once with `new-signing-key.ps1` (the private key stays in `%USERPROFILE%\.tuno`; the public key is built into the exe).
If Tuno lives in a folder it can't write to (such as Program Files), it simply can't update itself there.

## Build it

```powershell
.\build.ps1        # -> dist\Tuno.exe
```

You need the .NET SDK (only for its C# compiler) and internet on the first run: the script downloads Microsoft's
`Microsoft.Web.WebView2` NuGet package into `.deps` and packs its three small libraries (compressed) into the exe, so the
result is a single file. Nothing else is installed. The code is one file, [`Tuno.cs`](Tuno.cs).

## About memory

Most of Tuno's memory is the web engine, not the app: the exe itself uses about 25 MB, and WebView2's processes
add roughly 170 MB for a page like this one (about 200 MB in total while playing, about 175 MB minimized). That is the
floor for any WebView2 or Chromium based app, and it is a fraction of what a bundled-browser (Electron) app uses.
Chromium switches such as `--in-process-gpu` and `--enable-low-end-device-mode` made no measurable difference when
tried, but you can experiment by adding `extraBrowserArgs=...` to `%LOCALAPPDATA%\Tuno\settings.txt`.

The exe is not code-signed, so Windows SmartScreen may ask for confirmation if you copy it from the internet.

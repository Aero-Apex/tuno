# Tuno for Windows

A very small native Windows app for your Tuno server. `Tuno.exe` is under 1 MB: a window that hosts the **WebView2**
runtime already installed with Windows 11 and recent Windows 10 (the same engine as Edge), so there is no bundled
browser, no installer and nothing running in the background. It's written in Rust; the code is in
[`../desktop`](../desktop) and is shared with the Mac app.

What it adds over a browser tab:

- its own icon, taskbar entry and dark title bar
- media keys and the Windows media overlay (play/pause, next, previous, cover art) work with Tuno
- remembers the server address, window size and position
- a "Can't reach your server" page that retries by itself and opens the moment the server answers (handy with a VPN)
- while minimized it asks WebView2 to trim its memory (audio keeps playing)
- one window only: starting it again brings the running one to the front
- **updates itself** from your server (see below); the page goes to sleep while the window is minimized and nothing is playing
- the page title shows the song that's playing; `F11` toggles full screen; links to other sites open in your browser
- **runs on its own, with no server** when it has its engine folder next to it (see `build-local.ps1`)
- shows what you're listening to on your Discord profile (Settings → This PC)

## Use it

Run `Tuno.exe`. The first time it asks where to keep your music: on this PC (the on-PC edition) or on a Tuno server,
and then for the server's address (for example `http://192.168.1.50:7070` or `https://music.example.com`).

- **Change the server:** right-click the title bar (or press `Alt+Space`) and choose *Change server...*
- **Reload:** right-click the title bar and choose *Reload*
- You can also launch it with an address: `Tuno.exe http://192.168.1.50:7070`
- Settings and the browser profile live in `%LOCALAPPDATA%\Tuno`. Set the `TUNO_HOME` environment variable to keep
  them somewhere else (for a portable copy on a USB stick). A copy with its own `TUNO_HOME` can run next to the
  installed one.

Needs Windows 10 (64-bit) or 11 and the WebView2 Runtime. If the runtime is missing, Tuno offers to open Microsoft's
download page.

## Updates

When Tuno opens (and every 6 hours after) it asks your server for a newer `Tuno.exe`. A new build is downloaded in the background and
installed when nothing has played for a minute, or when you close Tuno. It only trusts builds signed with your private update key:
the checksum, the signature and the version inside the file must all check out. Right-click the title bar for
*Check for updates* and the *Update automatically* switch. Check results are logged in `%LOCALAPPDATA%\Tuno\update.log`.

To release an update: raise the number in `VERSION`, run `build.ps1`, then `..\scripts\publish-update.ps1 -Platform windows`.
Create the key pair once with `new-signing-key.ps1` (the private key stays in `%USERPROFILE%\.tuno`; the public key is built into the exe).
If Tuno lives in a folder it can't write to (such as Program Files), it simply can't update itself there.

The Rust app reads the same settings, update files and signatures as the earlier C# app, and the on-PC library's
lock and secret work the same way, so an installed C# Tuno updates to the Rust one without anyone noticing.

## Build it

```powershell
.\build.ps1        # -> dist\Tuno.exe
```

You need Rust ([rustup.rs](https://rustup.rs)) with the MSVC toolchain, which uses Visual Studio's C++ build tools and
the Windows SDK. The icon, the manifest and the version (from `VERSION`) are built into the exe, and WebView2's loader
is linked in, so the result is a single file. `build-local.ps1` builds the on-PC edition around it.

## About memory

Most of Tuno's memory is the web engine, not the app: WebView2's processes use roughly 170 MB for a page like this
one. That is the floor for any WebView2 or Chromium based app, and it is a fraction of what a bundled-browser
(Electron) app uses. You can experiment with Chromium switches by adding `extraBrowserArgs=...` to
`%LOCALAPPDATA%\Tuno\settings.txt`.

The exe is not code-signed, so Windows SmartScreen may ask for confirmation if you copy it from the internet.

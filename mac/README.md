# Tuno for macOS

`Tuno.app` is a small native window (AppKit and WebKit, no Electron) around your Tuno server's web app. It runs on
macOS 11 and newer, on both Apple Silicon and Intel Macs, and the download is about 6 MB.

What it adds over a browser tab:

- Its own Dock icon and menu bar. **Tuno → Settings…** (⌘,) and **Tuno → Change Server…** live there.
- Closing the window keeps the music playing, like Spotify. Click the Dock icon to bring it back, and quit with ⌘Q.
- It remembers the window's size and position.
- A "Can't reach your Tuno server" page that reconnects by itself.
- Your Discord profile shows what you're listening to. Discord must be open on the same Mac. Turn it off under
  Settings → This Mac.
- Links to other sites open in your browser, and downloads go to your Downloads folder.

The first time it opens, it asks for your server's address (`https://tuno.eu.cc` is filled in).

## Install

Download `Tuno-<version>-mac.zip` from the [Releases](../../../releases) page, open it, and drag Tuno to Applications.

The app isn't signed with an Apple Developer ID, so macOS blocks it the first time. The surest way past that is one
line in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Tuno.app
```

Or without Terminal:

- **macOS 15 (Sequoia) and newer:** open Tuno once, then go to **System Settings → Privacy & Security** and click
  **Open Anyway** next to the message about Tuno.
- **macOS 14 and older:** right-click Tuno in Applications, choose **Open**, then **Open** again.

After the first time, Tuno opens normally. It doesn't update itself yet: install a newer zip over it.

## Build

It's written in Go against the Objective-C runtime ([purego](https://github.com/ebitengine/purego)), with no C
compiler involved, so **any computer with Go can build it**. No Mac needed:

- **Windows:** `.\mac\build.ps1`
- **Mac or Linux:** `bash mac/build.sh`
- **GitHub:** Actions → **macOS app** → **Run workflow**, or push a version tag (the zip is added to its release).

Both scripts compile the app for Apple Silicon and Intel, then `go run ./pack` joins them into one universal
binary, makes the Dock icon from `web/public/icon-512.png`, writes `Info.plist` and zips `Tuno.app` into
`mac/dist`. Go's linker signs the Apple Silicon build itself, which is what Apple Silicon Macs need to run it.

The version comes from `mac/VERSION`.

| File | What it does |
| --- | --- |
| `app/main.go` | The window, menu bar, web view, offline page, downloads and the messages to and from the page |
| `app/discord.go` | The Discord listening status, over Discord's local socket |
| `app/cocoa.go` | Small helpers for calling AppKit and WebKit from Go |
| `pack/main.go` | Builds the universal binary, the icon and the zip |

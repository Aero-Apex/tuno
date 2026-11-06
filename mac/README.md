# Tuno for macOS

`Tuno.app` is a small native window (AppKit and WebKit, no Electron) around your Tuno server's web app. It runs on
macOS 11 and newer, on both Apple Silicon and Intel Macs.

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

Download `Tuno-<version>.dmg` from the [Releases](../../../releases) page, open it, and drag Tuno to Applications.

The app isn't signed with an Apple Developer ID, so macOS blocks it the first time:

- **macOS 15 (Sequoia) and newer:** open Tuno once, then go to **System Settings → Privacy & Security** and click
  **Open Anyway** next to the message about Tuno.
- **macOS 14 and older:** right-click Tuno in Applications, choose **Open**, then **Open** again.

Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/Tuno.app`

After the first time, Tuno opens normally. It doesn't update itself yet: install a newer DMG over it.

## Build

A Mac is needed to compile it. Either:

- **On GitHub:** Actions → **macOS app** → **Run workflow**. The DMG and zip are attached to the run. Pushing a
  version tag also builds it and adds the files to that tag's release.
- **On a Mac:** install the command line tools (`xcode-select --install`), then run `bash mac/build.sh`. The app,
  the DMG and the zip land in `mac/dist`.

The version comes from `mac/VERSION`.

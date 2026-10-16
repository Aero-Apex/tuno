# Tuno

Tuno is your own music hub, a mix of YouTube Music, Spotify and SoundCloud that runs on your home server.

- **Paste a link** to a song, album or playlist. Tuno downloads it to your server and you can play it any time, even if the original disappears.
- **Search** YouTube Music, YouTube, SoundCloud and your library at once. You can stream any result right away, or tap ☁ to keep it.
- **Spotify links** work too. Spotify audio can't be downloaded, so Tuno reads the song list and finds each song on YouTube Music, matching by title, artist and length.
- **Fully themeable** under Settings → Appearance: presets, every color, fonts, corner roundness, density, sidebar side, floating player, background image with blur, album-art colors, a visualizer and custom CSS. You can export and import themes. The theme is saved on the server, so every device gets it.

**Live at https://tuno.eu.cc** (through a Cloudflare tunnel), and at http://192.168.88.32:7070 on the home network.

## Using it

| Want to… | Do this |
| --- | --- |
| Download a song or playlist | Click **Add from link**, paste a link into the search bar, or just press Ctrl+V anywhere |
| Stream before downloading | Search, then click a result's cover |
| Keep a streamed song | ☁ button in the player or on the result |
| Get new songs added to an imported playlist | Open the playlist → 🔄 **Sync** |
| Watch progress / retry failures | **Downloads** page |
| Use it on your phone | Open the URL on the same Wi-Fi. Lock-screen and headphone controls work |

Keyboard: Space play/pause · ←/→ seek · Shift+←/→ prev/next · ↑/↓ volume · M mute · S shuffle · R repeat · L like · Q queue · F full screen · / search.

## Where things live on the server

```
~/tuno/app       code (replaced on each deploy)
~/tuno/data      tuno.db (library, playlists, settings), custom covers, cookies.txt
~/tuno/library   your music: <artist>/<title> [id].m4a|opus, with cover .jpg next to it
```

To back up, copy `~/tuno/data` and `~/tuno/library`.

## Deploy / update

From this folder on Windows:

```powershell
.\deploy.ps1
```

The script packs the source, uploads it over SSH (key login), and runs `docker compose up -d --build` on the server. Your data and music are kept.

Useful commands on the server:

```bash
cd ~/tuno/app
docker compose logs -f      # live logs
docker compose restart      # restart
docker compose down         # stop
```

## Develop locally

```powershell
npm install
npm run dev          # API on :7070, web app on http://localhost:5173
```

Local development needs Python with `pip install "yt-dlp[default]"`, plus ffmpeg on PATH. `server/.env` points yt-dlp at Node 22+, which YouTube needs.

## Troubleshooting

- **YouTube says "Sign in to confirm you're not a bot".** Paste cookies under Settings → Sources → YouTube cookies.
- **Downloads suddenly fail.** Go to Settings → System → **Update yt-dlp**. A redeploy also installs the newest version.
- **Spotify playlists with more than about 100 songs.** Add a free Spotify developer app's Client ID and Secret under Settings → Sources.
- **Bandcamp.** As of Oct 2026, Bandcamp shows a bot check to automated tools, so yt-dlp can't read its pages. Search the song in Tuno instead.

## Stack

Node 22 · Fastify · SQLite (better-sqlite3) · yt-dlp + ffmpeg · youtubei.js (YT Music search) · React 19 · Vite · Tailwind · Zustand · TanStack Query · Docker.

## Android app

A native Android app (Kotlin, Jetpack Compose, Media3) lives in [`android/`](android). It looks and works like the
Spotify app (Home, Search, Your Library, mini player and Now Playing), logs in to your Tuno server, downloads links
(also via "Share → Tuno") and plays music in the background with lock-screen controls.
Songs you play are kept on the phone (up to 250 MB), so replays use no data and put no load on the server.

Download the signed APK from the [Releases](../../releases) page and install it (allow "install unknown apps").
To build it yourself, see [`android/README.md`](android/README.md).

## Windows app

[`windows/`](windows) builds `Tuno.exe`, a ~370 KB native window around the WebView2 runtime that Windows already has,
pointed at your server. It adds what a browser tab can't: its own taskbar entry and icon, media keys and the Windows
media overlay, remembered window size, a friendly "can't reach your server" page that reconnects by itself, and
automatic memory trimming while minimized. Run `windows/build.ps1` to build it; see [`windows/README.md`](windows/README.md).

## Automatic updates (Android and Windows)

Both apps update themselves from your own server, with no store and no GitHub needed.

1. Build the app (`android/gradlew assembleRelease`, or `windows/build.ps1`). Bump the version first: `versionCode` and
   `versionName` in `android/app/build.gradle.kts`, or the number in `windows/VERSION`.
2. Publish it: `.\scripts\publish-update.ps1 -Platform android` or `-Platform windows`. This copies the build and a small
   manifest to `data/updates` on the server over SSH. It's live as soon as it uploads; there is nothing to restart.
3. Installed apps check when they open (at most every 6 hours), download the new build in the background, verify it, and install it
   once no music is playing. Both have an "update automatically" switch and a manual "Check for updates".

How updates are kept safe:

- **Windows:** `Tuno.exe` only installs a build signed with your private key. Create it once with `windows/new-signing-key.ps1`; it
  stays on your PC (`%USERPROFILE%\.tuno`) and only the public half is built into the app, so a hacked server can't push code to your PC.
  Checksum, signature and the version inside the exe are all verified, and an old signed build can't be replayed as a "new" one.
- **Android:** the APK's checksum and signing certificate must match the installed app (Android enforces the same rule itself). The first
  update asks you to allow Tuno to install apps (Settings > Updates > Allow); on Android 12 and newer later updates install silently.

The very first install of an updater-capable build is manual (copy the APK or exe once); every update after that is automatic.

## Notes

- Links to **Genius** lyrics pages can't be downloaded (Genius answers 403 to anything but a browser). Tuno reads the song name from the
  link and finds the song on YouTube Music, YouTube or SoundCloud instead.
- Covers are served resized (`/api/cover/<id>?w=128|256|512`, cached in `data/thumbs`) so lists don't download full-size images.

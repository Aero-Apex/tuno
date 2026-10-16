# Tuno for Android

Native Android client for a Tuno server (Kotlin, Jetpack Compose, Media3, OkHttp, Coil). About 2 MB installed from the APK.

- Spotify-style layout: Home (shortcuts, Jump back in, Recently added, On repeat, mixes, top artists), Search (browse
  cards, recent searches, results from YT Music, YouTube, SoundCloud or your library), Your Library (filter chips,
  sorting, list/grid view, Liked Songs pinned) and a Create menu.
- Playlist, album and artist pages with cover-colored headers; create, rename and delete playlists, add or remove songs.
- Floating mini player tinted with the cover's color (swipe sideways to skip); Now Playing with seek bar, shuffle,
  repeat, queue and share (drag down to close).
- Log in with your Tuno password (server address defaults to `https://tuno.eu.cc`; change it on the login screen).
- Download from a link (or "Share → Tuno" from YouTube, Spotify, SoundCloud…) and follow the downloads queue.
- Background playback with notification / lock-screen controls; replayed songs come from an on-device cache (250 MB, oldest dropped first).
- Uses the accent color from your account's Appearance settings on the web.
- Updates itself: it checks your server when opened, downloads new builds in the background, verifies them (checksum and signing
  certificate) and installs them once no music is playing. Settings > Updates has the on/off switch and a manual check. The first update
  asks you to allow Tuno to install apps; after that, Android 12+ installs silently. Publish builds with `scripts/publish-update.ps1`.
- Covers are requested at the size they're drawn (a few KB instead of up to several MB).
- Needs Android 8.0 (API 26) or newer.

## Build

Requires JDK 17 and the Android SDK (platform 35). From this folder:

```bash
./gradlew :app:assembleRelease
```

The APK is written to `app/build/outputs/apk/release/`.

Raise `versionCode` and `versionName` in `app/build.gradle.kts` for every release, or installed copies won't see it as an update
(`-PtunoVersionCode=` and `-PtunoVersionName=` override them for a test build).

### Signing

Release builds are signed with the keystore described in `keystore.properties` (not in the repository):

```
storeFile=/path/to/tuno-release.jks
storePassword=...
keyAlias=tuno
keyPassword=...
```

Without that file the debug key is used. Updates only install over an existing install when they are signed with the same key,
so keep a backup of your keystore.

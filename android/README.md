# Tuno for Android

Native Android client for a Tuno server (Kotlin, Jetpack Compose, Media3, OkHttp, Coil). About 2 MB installed from the APK.

- Log in with your Tuno password (server address defaults to `https://tuno.eu.cc`; change it on the login screen).
- Library (songs, playlists, liked), search (YT Music, YouTube, SoundCloud), paste a link to download, downloads queue, account and storage.
- Background playback with notification / lock-screen controls; replayed songs come from an on-device cache (250 MB, oldest dropped first).
- Uses the colors from your account's Appearance settings on the web.
- Needs Android 8.0 (API 26) or newer.

## Build

Requires JDK 17 and the Android SDK (platform 35). From this folder:

```bash
./gradlew :app:assembleRelease
```

The APK is written to `app/build/outputs/apk/release/`.

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

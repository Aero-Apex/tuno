#!/bin/bash
# Builds Tuno.app for macOS (one universal app for Apple Silicon and Intel), then a .dmg and a .zip of it.
# Needs a Mac with the Xcode command line tools (xcode-select --install). GitHub Actions runs this on its Macs:
# see .github/workflows/mac.yml.
#   Usage:  bash mac/build.sh   ->  mac/dist/Tuno.app, mac/dist/Tuno-<version>.dmg, mac/dist/Tuno-<version>-mac.zip
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
version="$(tr -d '[:space:]' < "$here/VERSION")"
dist="$here/dist"
obj="$here/obj"
app="$dist/Tuno.app"

rm -rf "$dist" "$obj"
mkdir -p "$obj" "$app/Contents/MacOS" "$app/Contents/Resources"

echo "==> Compiling Tuno $version"
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos11.0" \
    "$here/main.swift" "$here/Discord.swift" -o "$obj/Tuno-$arch"
done
lipo -create "$obj/Tuno-arm64" "$obj/Tuno-x86_64" -output "$app/Contents/MacOS/Tuno"

echo "==> Bundling"
sed "s/__VERSION__/$version/g" "$here/Info.plist" > "$app/Contents/Info.plist"
printf 'APPL????' > "$app/Contents/PkgInfo"

# The Dock icon, made from the web app's 512 px icon.
iconset="$obj/Tuno.iconset"
mkdir -p "$iconset"
src="$here/../web/public/icon-512.png"
for size in 16 32 128 256; do
  sips -z $size $size "$src" --out "$iconset/icon_${size}x${size}.png" > /dev/null
  sips -z $((size * 2)) $((size * 2)) "$src" --out "$iconset/icon_${size}x${size}@2x.png" > /dev/null
done
cp "$src" "$iconset/icon_512x512.png"
iconutil -c icns "$iconset" -o "$app/Contents/Resources/Tuno.icns"

# Ad-hoc signature: Apple Silicon Macs won't run unsigned code at all. It isn't a Developer ID signature, so
# macOS still asks the first time (see mac/README.md).
codesign --force --deep --sign - "$app"

echo "==> Packing"
ditto -c -k --sequesterRsrc --keepParent "$app" "$dist/Tuno-$version-mac.zip"
staging="$obj/dmg"
mkdir -p "$staging"
cp -R "$app" "$staging/"
ln -s /Applications "$staging/Applications"
hdiutil create -volname "Tuno" -srcfolder "$staging" -ov -format UDZO "$dist/Tuno-$version.dmg" > /dev/null

echo "==> Built Tuno $version for macOS:"
ls -lh "$dist"

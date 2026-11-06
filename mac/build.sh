#!/bin/bash
# Builds Tuno for macOS (one universal app for Apple Silicon and Intel) and zips it. Needs Go, nothing else:
# it works on a Mac, on Linux, and on Windows (Git Bash) alike, because the app needs no C compiler.
# On Windows you can also run build.ps1.
#   Usage:  bash mac/build.sh   ->  mac/dist/Tuno-<version>-mac.zip
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
version="$(tr -d '[:space:]' < VERSION)"

rm -rf obj
mkdir -p obj dist
for arch in arm64 amd64; do
  echo "==> Compiling Tuno $version for $arch"
  CGO_ENABLED=0 GOOS=darwin GOARCH=$arch go build -trimpath -ldflags "-s -w" -o "obj/tuno-$arch" ./app
done

echo "==> Packing Tuno.app"
go run ./pack -version "$version" -arm64 obj/tuno-arm64 -amd64 obj/tuno-amd64 -icon ../web/public/icon-512.png -out dist

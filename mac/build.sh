#!/bin/bash
# Builds Tuno for macOS (one universal app for Apple Silicon and Intel) and zips it.
# On a Mac it uses Rust alone; on Linux (and in GitHub Actions) Zig links the Mac binaries, so no Mac is needed.
# Needs Rust (rustup.rs) and, once:
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin
#   on Linux also:  pip install ziglang cargo-zigbuild
# On Windows, use build.ps1.
#   Usage:  bash mac/build.sh   ->  mac/dist/Tuno-<version>-mac.zip
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
desktop="$root/desktop"
version="$(tr -d '[:space:]' < "$here/VERSION")"

build=(cargo zigbuild)
[ "$(uname)" = "Darwin" ] && build=(cargo build)
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  echo "==> Compiling Tuno $version for $target"
  "${build[@]}" --release --target "$target" --manifest-path "$desktop/Cargo.toml"
done

echo "==> Packing Tuno.app"
cargo run --release --manifest-path "$desktop/pack/Cargo.toml" -- "$version" \
  "$desktop/target/aarch64-apple-darwin/release/tuno" "$desktop/target/x86_64-apple-darwin/release/tuno" \
  "$root/web/public/icon-512.png" "$here/Info.plist" "$here/dist"

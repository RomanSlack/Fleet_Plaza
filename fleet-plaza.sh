#!/usr/bin/env bash
# Launch Fleet Plaza (release build). Build first with: npm run tauri build
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/src-tauri/target/release/fleet-plaza"
[ -x "$BIN" ] || { echo "No release binary at $BIN — run: npm run tauri build" >&2; exit 1; }
# Belt-and-braces: also set here in case the in-process fix is ever removed.
exec env WEBKIT_DISABLE_DMABUF_RENDERER=1 "$BIN" "$@"

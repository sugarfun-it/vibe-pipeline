#!/bin/sh
# vibe-pipeline enduser uninstaller (POSIX)
# Usage: curl -fsSL https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/uninstall.sh | sh

set -e

VP_HOME="$HOME/.vibe-pipeline"
APP_DIR="$VP_HOME/app"
SHIM="$HOME/.local/bin/vbpl"

msg() { printf '%s\n' "$*"; }

# 1) Stop backend (best effort)
if [ -x "$SHIM" ]; then
  msg "停 backend ..."
  "$SHIM" server stop 2>/dev/null || true
elif command -v bun >/dev/null 2>&1 && [ -f "$APP_DIR/cli/vbpl.ts" ]; then
  VBPL_HOME="$APP_DIR" bun run "$APP_DIR/cli/vbpl.ts" server stop 2>/dev/null || true
fi

# 2) Remove app dir
if [ -d "$APP_DIR" ]; then
  rm -rf "$APP_DIR"
  msg "✓ 移除 $APP_DIR"
fi

# 3) Remove shim
if [ -e "$SHIM" ] || [ -L "$SHIM" ]; then
  rm -f "$SHIM"
  msg "✓ 移除 $SHIM"
fi

msg ""
msg "Uninstalled."
msg "註:$VP_HOME/ 內 state / auth / worktrees 沒動。要全清:"
msg "  rm -rf $VP_HOME"

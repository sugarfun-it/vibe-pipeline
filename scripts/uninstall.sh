#!/bin/sh
# vibe-pipeline enduser uninstaller (POSIX: macOS / Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/sugarfun-it/vibe-pipeline/main/scripts/uninstall.sh | sh
#
# Removes versioned install + shim. State / auth / worktrees under
# ~/.vibe-pipeline/ (other than versions/ current/ bin/) are preserved.
# To nuke everything: rm -rf ~/.vibe-pipeline

set -e

VP_HOME="$HOME/.vibe-pipeline"
VERSIONS_DIR="$VP_HOME/versions"
CURRENT="$VP_HOME/current"
SHIM_DIR="$VP_HOME/bin"
SHIM="$SHIM_DIR/vbpl"

# Legacy paths (pre-v0.2.1):
LEGACY_SHIM="$HOME/.local/bin/vbpl"
LEGACY_APP="$VP_HOME/app"            # pre-versioned install
LEGACY_APP_BAK="$VP_HOME/app.legacy.bak"

msg() { printf '%s\n' "$*"; }

# 1) Stop backend (best effort, try shim first then current/)
if [ -x "$SHIM" ]; then
  msg "Stopping backend ..."
  "$SHIM" server stop 2>/dev/null || true
elif command -v bun >/dev/null 2>&1 && [ -f "$CURRENT/cli/vbpl.ts" ]; then
  VBPL_HOME="$CURRENT" bun run "$CURRENT/cli/vbpl.ts" server stop 2>/dev/null || true
fi

# 2) Remove current symlink (link entry only; target version dir gets removed separately)
if [ -L "$CURRENT" ]; then
  rm -f "$CURRENT"
  msg "OK Removed symlink $CURRENT"
elif [ -d "$CURRENT" ]; then
  rm -rf "$CURRENT"
  msg "OK Removed $CURRENT"
fi

# 3) Remove all version dirs
if [ -d "$VERSIONS_DIR" ]; then
  rm -rf "$VERSIONS_DIR"
  msg "OK Removed $VERSIONS_DIR"
fi

# 4) Remove shim + shim dir (if empty)
if [ -e "$SHIM" ] || [ -L "$SHIM" ]; then
  rm -f "$SHIM"
  msg "OK Removed $SHIM"
fi
if [ -d "$SHIM_DIR" ] && [ -z "$(ls -A "$SHIM_DIR" 2>/dev/null)" ]; then
  rmdir "$SHIM_DIR" 2>/dev/null || true
fi

# 5) Cleanup legacy paths (pre-v0.2.1)
if [ -e "$LEGACY_SHIM" ] || [ -L "$LEGACY_SHIM" ]; then
  rm -f "$LEGACY_SHIM"
  msg "OK Removed legacy shim $LEGACY_SHIM"
fi
if [ -d "$LEGACY_APP" ] && [ ! -L "$LEGACY_APP" ]; then
  rm -rf "$LEGACY_APP"
  msg "OK Removed legacy $LEGACY_APP"
fi
if [ -d "$LEGACY_APP_BAK" ]; then
  rm -rf "$LEGACY_APP_BAK"
  msg "OK Removed legacy backup $LEGACY_APP_BAK"
fi

msg ""
msg "Uninstalled."
msg "Note: state / auth / worktrees under $VP_HOME are preserved."
msg "To wipe everything: rm -rf $VP_HOME"

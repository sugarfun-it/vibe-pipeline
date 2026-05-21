#!/bin/sh
# vibe-pipeline enduser installer (POSIX: macOS / Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.sh | sh
#
# Layout (Scoop-style versioned + current symlink):
#   ~/.vibe-pipeline/versions/v0.1.X/   actual version dir
#   ~/.vibe-pipeline/current            symlink -> versions/v0.1.X/
#   ~/.local/bin/vbpl                   shim, runs from $current
#
# self-update only writes to versions/v<NEW>/ + a .pending file. `vbpl server start`
# detects .pending, swaps current. No process self-replacement, no detach magic.

set -e

REPO="eric14304/vibe-pipeline"
VP_HOME="$HOME/.vibe-pipeline"
VERSIONS_DIR="$VP_HOME/versions"
CURRENT="$VP_HOME/current"
# Shim 統一放 ~/.vibe-pipeline/bin/ 對齊 pyenv/cargo/nvm 慣例 + 跟舊 vbpl 同位置 +
# uninstall 一鍵 rm ~/.vibe-pipeline/ 全清。舊版誤放 ~/.local/bin/vbpl 自動 cleanup。
SHIM_DIR="$VP_HOME/bin"
SHIM="$SHIM_DIR/vbpl"
OLD_SHIM="$HOME/.local/bin/vbpl"

msg() { printf '%s\n' "$*"; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

# 1) Bun check
if ! command -v bun >/dev/null 2>&1; then
  err "Bun is not installed. Install Bun first:"
  err "  curl -fsSL https://bun.sh/install | bash"
  err "Then open a new terminal and re-run install.sh"
  exit 1
fi
msg "OK Bun: $(bun --version)"

# 2) Latest release
msg "Fetching latest release ..."
API_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") || {
  err "Failed to fetch release info"; exit 1;
}

TAG=$(printf '%s' "$API_JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
if [ -z "$TAG" ]; then
  err "tag_name not found in release JSON"
  exit 1
fi
msg "OK Latest tag: $TAG"

# 3) Pick asset: prefer .tar.gz; fall back to tarball_url
ASSET_URL=$(printf '%s' "$API_JSON" \
  | tr ',' '\n' \
  | sed -n 's/.*"browser_download_url": *"\([^"]*\.\(tar\.gz\|tgz\)\)".*/\1/p' \
  | head -n1)

if [ -z "$ASSET_URL" ]; then
  ASSET_URL=$(printf '%s' "$API_JSON" | sed -n 's/.*"tarball_url": *"\([^"]*\)".*/\1/p' | head -n1)
  msg "  No .tar.gz asset, using tarball_url fallback"
fi

if [ -z "$ASSET_URL" ]; then
  err "No download URL found"
  exit 1
fi
msg "OK Download URL: $ASSET_URL"

# 4) Download
TARBALL="/tmp/vibe-pipeline-$TAG.tar.gz"
msg "Downloading to $TARBALL ..."
curl -fsSL -o "$TARBALL" "$ASSET_URL" || { err "Download failed"; exit 1; }

# 5) Stage extract to versions/$TAG (independent, never touches running backend)
mkdir -p "$VERSIONS_DIR"
VERSION_DIR="$VERSIONS_DIR/$TAG"

# overwrite existing same-version dir (retry / re-install case)
if [ -d "$VERSION_DIR" ]; then
  msg "Removing existing $VERSION_DIR"
  rm -rf "$VERSION_DIR"
fi
mkdir -p "$VERSION_DIR"

msg "Extracting ..."
# tarball/zipball top-level is usually <repo>-<sha>/ → strip
if ! tar -xzf "$TARBALL" -C "$VERSION_DIR" --strip-components=1 2>/dev/null; then
  err "Extract failed"
  rm -rf "$VERSION_DIR"
  exit 1
fi
msg "OK Extracted -> $VERSION_DIR"
rm -f "$TARBALL"

# 6) Install deps in $VERSION_DIR
msg "Running bun install (30s ~ 2 min) ..."
(cd "$VERSION_DIR" && bun install --silent) || {
  err "bun install failed"; exit 1;
}

# 7) Swap `current` symlink
if [ -L "$CURRENT" ] || [ -d "$CURRENT" ]; then
  msg "Removing old current link"
  rm -rf "$CURRENT"
fi
ln -s "$VERSION_DIR" "$CURRENT"
msg "OK current -> $VERSION_DIR"

# 7.5) Legacy migration: old layout had app/ directly. Move to app.legacy.bak/ if real dir.
LEGACY_APP="$VP_HOME/app"
if [ -d "$LEGACY_APP" ] && [ ! -L "$LEGACY_APP" ]; then
  LEGACY_BAK="$VP_HOME/app.legacy.bak"
  rm -rf "$LEGACY_BAK" 2>/dev/null || true
  if mv "$LEGACY_APP" "$LEGACY_BAK" 2>/dev/null; then
    msg "Legacy $LEGACY_APP moved to $LEGACY_BAK (safe to delete)"
  else
    msg "WARN: legacy $LEGACY_APP move failed (in use?)"
  fi
fi

# 8) Shim points to current/
mkdir -p "$SHIM_DIR"
cat > "$SHIM" <<EOF
#!/bin/sh
export VBPL_HOME="\$HOME/.vibe-pipeline/current"
exec bun run "\$VBPL_HOME/cli/vbpl.ts" "\$@"
EOF
chmod +x "$SHIM"
msg "OK Shim: $SHIM"

# 8.5) Cleanup legacy shim at ~/.local/bin/vbpl (pre-v0.2.1)
if [ -e "$OLD_SHIM" ] || [ -L "$OLD_SHIM" ]; then
  rm -f "$OLD_SHIM" && msg "Cleaned up legacy shim $OLD_SHIM"
fi

# 9) PATH check + prompt
case ":$PATH:" in
  *":$SHIM_DIR:"*) IN_PATH=1 ;;
  *) IN_PATH=0 ;;
esac

if [ "$IN_PATH" = "0" ]; then
  if [ -r /dev/tty ]; then
    printf 'Add %s to PATH? (y/N) ' "$SHIM_DIR" > /dev/tty
    read REPLY < /dev/tty || REPLY=""
  else
    REPLY=""
  fi

  case "$REPLY" in
    y|Y|yes|YES)
      SH_NAME=$(basename "${SHELL:-sh}")
      case "$SH_NAME" in
        zsh)  RC="$HOME/.zshrc" ;;
        bash) RC="$HOME/.bashrc" ;;
        fish) RC="$HOME/.config/fish/config.fish" ;;
        *)    RC="$HOME/.profile" ;;
      esac
      if [ "$SH_NAME" = "fish" ]; then
        mkdir -p "$(dirname "$RC")"
        printf '\n# vibe-pipeline\nset -gx PATH %s $PATH\n' "$SHIM_DIR" >> "$RC"
      else
        printf '\n# vibe-pipeline\nexport PATH="%s:$PATH"\n' "$SHIM_DIR" >> "$RC"
      fi
      msg "OK Added to $RC (open new terminal or source $RC to take effect)"
      ;;
    *)
      msg "PATH not modified. To add manually run:"
      msg "  export PATH=\"$SHIM_DIR:\$PATH\""
      ;;
  esac
fi

# 10) Auto-start backend (via current/)
msg ""
msg "Starting backend ..."
VBPL_HOME="$CURRENT" bun run "$CURRENT/cli/vbpl.ts" server start || {
  err "server start failed. Try manually: vbpl server start"
}

msg ""
msg "OK Installed $TAG at $VERSION_DIR"
msg "OK current -> $VERSION_DIR"
msg "OK Backend: http://localhost:3001"
msg ""
msg "Done. Run 'vbpl --help' for commands."

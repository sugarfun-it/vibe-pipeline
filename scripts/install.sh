#!/bin/sh
# vibe-pipeline enduser installer (POSIX: macOS / Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.sh | sh

set -e

REPO="eric14304/vibe-pipeline"
VP_HOME="$HOME/.vibe-pipeline"
APP_DIR="$VP_HOME/app"
APP_BAK="$VP_HOME/app.bak"
SHIM_DIR="$HOME/.local/bin"
SHIM="$SHIM_DIR/vbpl"

msg() { printf '%s\n' "$*"; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

# 1) Bun check
if ! command -v bun >/dev/null 2>&1; then
  err "Bun 未安裝。請先跑:"
  err "  curl -fsSL https://bun.sh/install | bash"
  err "裝完重開 terminal 再跑 install.sh"
  exit 1
fi
msg "✓ Bun: $(bun --version)"

# 2) Latest release
msg "查 latest release ..."
API_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") || {
  err "抓 release info 失敗"; exit 1;
}

TAG=$(printf '%s' "$API_JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
if [ -z "$TAG" ]; then
  err "無法解析 tag_name"
  exit 1
fi
msg "✓ Latest tag: $TAG"

# 找 .tar.gz / .tgz asset;沒有 → tarball_url fallback
ASSET_URL=$(printf '%s' "$API_JSON" \
  | tr ',' '\n' \
  | sed -n 's/.*"browser_download_url": *"\([^"]*\.\(tar\.gz\|tgz\)\)".*/\1/p' \
  | head -n1)

if [ -z "$ASSET_URL" ]; then
  ASSET_URL=$(printf '%s' "$API_JSON" | sed -n 's/.*"tarball_url": *"\([^"]*\)".*/\1/p' | head -n1)
  msg "  無 .tar.gz asset,改用 tarball_url"
fi

if [ -z "$ASSET_URL" ]; then
  err "找不到 tarball URL"
  exit 1
fi
msg "✓ Download URL: $ASSET_URL"

# 3) Download
TARBALL="/tmp/vibe-pipeline-$TAG.tar.gz"
msg "下載到 $TARBALL ..."
curl -fsSL -o "$TARBALL" "$ASSET_URL" || { err "下載失敗"; exit 1; }

# 4) Extract (safety net: mv app → app.bak)
mkdir -p "$VP_HOME"
if [ -d "$APP_DIR" ]; then
  rm -rf "$APP_BAK"
  mv "$APP_DIR" "$APP_BAK"
fi
mkdir -p "$APP_DIR"

msg "解壓 ..."
# tarball 第一層通常是 <repo>-<sha>/,strip 掉
if tar -xzf "$TARBALL" -C "$APP_DIR" --strip-components=1 2>/dev/null; then
  rm -rf "$APP_BAK"
  msg "✓ 解壓 → $APP_DIR"
else
  err "解壓失敗,回滾"
  rm -rf "$APP_DIR"
  if [ -d "$APP_BAK" ]; then mv "$APP_BAK" "$APP_DIR"; fi
  exit 1
fi
rm -f "$TARBALL"

# 4.5) Install deps
msg "bun install (可能要 30s ~ 2 分鐘) ..."
(cd "$APP_DIR" && bun install --silent) || {
  err "bun install 失敗"; exit 1;
}

# 5) Shim
mkdir -p "$SHIM_DIR"
cat > "$SHIM" <<EOF
#!/bin/sh
export VBPL_HOME="\$HOME/.vibe-pipeline/app"
exec bun run "\$VBPL_HOME/cli/vbpl.ts" "\$@"
EOF
chmod +x "$SHIM"
msg "✓ Shim: $SHIM"

# 6) PATH check + prompt
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
      msg "✓ 已加進 $RC — 開新 terminal 或 source $RC 生效"
      ;;
    *)
      msg "PATH 沒加。要手動跑:"
      msg "  export PATH=\"$SHIM_DIR:\$PATH\""
      ;;
  esac
fi

# 7) Auto-start backend
msg ""
msg "啟動 backend ..."
VBPL_HOME="$APP_DIR" bun run "$APP_DIR/cli/vbpl.ts" server start || {
  err "server start 失敗,可手動跑:vbpl server start"
}

msg ""
msg "✓ Installed v$TAG at $APP_DIR"
msg "✓ Backend: http://localhost:3001"
msg ""
msg "Done. 跑 \`vbpl --help\` 看指令。"

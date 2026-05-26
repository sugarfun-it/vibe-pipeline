#!/usr/bin/env bash
# /prod — switch backend to enduser install stack (~/.vibe-pipeline/current)
# /prod skill (.claude/commands/prod.md) 是 wrapper,真實邏輯在這。

set -e

norm() { python -c "import sys; from pathlib import PurePath; print(PurePath(sys.argv[1]).as_posix().lower())" "$1"; }
read_field() { python -c "import json,pathlib,sys; d=json.loads(pathlib.Path.home().joinpath('.vibe-pipeline','server.json').read_text()); print(d.get(sys.argv[1],''))" "$1" 2>/dev/null; }
backend_up() { curl -fsS --max-time 2 "http://127.0.0.1:$1/api/health" >/dev/null 2>&1; }
force_kill_port() {
  local port=$1
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      python -c "import subprocess; subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'], capture_output=True)" 2>/dev/null || true
      ;;
    *)
      lsof -ti:$port 2>/dev/null | xargs -r kill -9 2>/dev/null || true
      ;;
  esac
}

EXPECTED=$(norm "$HOME/.vibe-pipeline/current")
CUR_REPO=$(read_field repo_path)
CUR_PORT=$(read_field port)

SHIM=$HOME/.vibe-pipeline/bin/vbpl
[ -f "$SHIM.exe" ] && SHIM=$SHIM.exe
[ -f "$SHIM.cmd" ] && [ ! -f "$SHIM.exe" ] && SHIM=$SHIM.cmd

# 1. idempotent skip
if [ -n "$CUR_REPO" ] && [ -n "$CUR_PORT" ] && [ "$(norm "$CUR_REPO")" = "$EXPECTED" ] && backend_up "$CUR_PORT"; then
  echo "[prod] already on install stack (port $CUR_PORT), no-op"
  curl -fsS "http://127.0.0.1:$CUR_PORT/api/system/version" | python -c "import json,sys; d=json.load(sys.stdin)['data']; print(f\"current={d['current']}\")"
  exit 0
fi

# 2. stop existing backend
echo "[prod] stop existing backend"
"$SHIM" server stop 2>&1 || true
[ -n "$CUR_PORT" ] && force_kill_port "$CUR_PORT"

# 3. start enduser backend via shim
echo "[prod] start enduser backend"
"$SHIM" server start 2>&1

# 4. poll-until-up (timeout 30s)
PORT=$(read_field port)
[ -z "$PORT" ] && { echo "[prod] server.json missing port"; exit 1; }
for i in $(seq 1 30); do
  if backend_up "$PORT"; then
    echo "[prod] backend up after ${i}s on port $PORT"
    break
  fi
  sleep 1
  [ "$i" -eq 30 ] && { echo "[prod] backend not up after 30s"; exit 1; }
done

# 5. tailscale forward sync (port 可能 EADDRINUSE fallback)
if command -v tailscale >/dev/null 2>&1; then
  echo "[prod] tailscale → http://localhost:$PORT"
  tailscale serve --bg --https=443 "http://localhost:$PORT" 2>&1 | tail -3
fi

# 6. report
curl -fsS "http://127.0.0.1:$PORT/api/system/version" | python -c "import json,sys; d=json.load(sys.stdin)['data']; print(f\"current={d['current']}\")"

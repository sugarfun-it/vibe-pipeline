#!/usr/bin/env bash
# /dev — switch backend to dev clone stack (idempotent, mtime-aware build, poll-until-up)
# /dev skill (.claude/commands/dev.md) 是 wrapper,真實邏輯在這。

set -e
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

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

EXPECTED=$(norm "$ROOT")
CUR_REPO=$(read_field repo_path)
CUR_PORT=$(read_field port)

# 1. idempotent skip: already on dev clone + alive → only verify
if [ -n "$CUR_REPO" ] && [ -n "$CUR_PORT" ] && [ "$(norm "$CUR_REPO")" = "$EXPECTED" ] && backend_up "$CUR_PORT"; then
  echo "[dev] already on dev clone (port $CUR_PORT), no-op"
  curl -fsS "http://127.0.0.1:$CUR_PORT/api/system/version" | python -c "import json,sys; d=json.load(sys.stdin)['data']; print(f\"current={d['current']}\")"
  exit 0
fi

# 2. stop existing backend
echo "[dev] stop existing backend"
bun run cli/vbpl.ts server stop 2>&1 || true
[ -n "$CUR_PORT" ] && force_kill_port "$CUR_PORT"

# 3. rebuild dist/ only when src/ newer than dist/
if [ ! -f dist/index.html ] || [ -n "$(find src -type f -newer dist/index.html 2>/dev/null | head -1)" ]; then
  echo "[dev] rebuild dist/ (src/ newer)"
  bun run build 2>&1 | tail -3
else
  echo "[dev] dist/ up-to-date, skip build"
fi

# 4. start dev backend
echo "[dev] start dev backend"
bun run cli/vbpl.ts server start 2>&1

# 5. poll-until-up (timeout 30s)
PORT=$(read_field port)
[ -z "$PORT" ] && { echo "[dev] server.json missing port"; exit 1; }
for i in $(seq 1 30); do
  if backend_up "$PORT"; then
    echo "[dev] backend up after ${i}s on port $PORT"
    break
  fi
  sleep 1
  [ "$i" -eq 30 ] && { echo "[dev] backend not up after 30s"; exit 1; }
done

# 6. report
curl -fsS "http://127.0.0.1:$PORT/api/system/version" | python -c "import json,sys; d=json.load(sys.stdin)['data']; print(f\"current={d['current']}\")"

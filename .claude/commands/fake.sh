#!/usr/bin/env bash
# /fake <version> — patch ~/.vibe-pipeline/current/package.json 假版本 + restart backend
# 製造「本機 < GH latest」假狀態給 maintainer 測 PWA update flow,不必跑 /release。
# /fake skill (.claude/commands/fake.md) 是 wrapper,真實邏輯在這。

set -e

VERSION_RAW=${1:-}
[ -z "$VERSION_RAW" ] && { echo "usage: bash .claude/commands/fake.sh <version>  例:0.2.0"; exit 1; }
VERSION=${VERSION_RAW#v}

PKG=$HOME/.vibe-pipeline/current/package.json
[ -f "$PKG" ] || { echo "[fake] $PKG 不存在 — 本機未裝 vbpl"; exit 1; }

norm() { python -c "import sys; from pathlib import PurePath; print(PurePath(sys.argv[1]).as_posix().lower())" "$1"; }
read_field() { python -c "import json,pathlib,sys; d=json.loads(pathlib.Path.home().joinpath('.vibe-pipeline','server.json').read_text()); print(d.get(sys.argv[1],''))" "$1" 2>/dev/null; }

# pre-check:backend 必須在 install layout(repo_path = ~/.vibe-pipeline/current)
EXPECTED=$(norm "$HOME/.vibe-pipeline/current")
CUR_REPO=$(read_field repo_path)
if [ -n "$CUR_REPO" ] && [ "$(norm "$CUR_REPO")" != "$EXPECTED" ]; then
  echo "[fake] backend repo_path = $CUR_REPO,不是 install layout"
  echo "       fake 只對 install layout 有意義(dev 模式版本走 git describe)。先跑 bash .claude/commands/prod.sh"
  exit 1
fi

# patch package.json (Python 在 Windows 不認 MSYS /c/... prefix,用 pathlib.Path.home() 構)
python -c "
import json, pathlib
pkg = pathlib.Path.home() / '.vibe-pipeline' / 'current' / 'package.json'
p = json.loads(pkg.read_text())
old = p['version']
p['version'] = '$VERSION'
pkg.write_text(json.dumps(p, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'[fake] {old} -> {p[\"version\"]}')
"

# restart backend(拆 stop + start,避 `restart` 子程序透過 bash pipe 卡 detach;對齊 prod.sh)
echo "[fake] restart backend"
SHIM=$HOME/.vibe-pipeline/bin/vbpl
[ -f "$SHIM.exe" ] && SHIM=$SHIM.exe
[ -f "$SHIM.cmd" ] && [ ! -f "$SHIM.exe" ] && SHIM=$SHIM.cmd
"$SHIM" server stop >/dev/null 2>&1 || true
sleep 1
"$SHIM" server start >/dev/null 2>&1 || true

# poll-until-up + report
PORT=$(read_field port)
[ -z "$PORT" ] && { echo "[fake] server.json missing port"; exit 1; }
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/system/version" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:$PORT/api/system/version" | python -c "import json,sys; d=json.load(sys.stdin)['data']; print(f\"[fake] backend up: current={d['current']} latest={d['latest']['tag'] if d['latest'] else 'none'} hasUpdate={d['hasUpdate']}\")"
    exit 0
  fi
  sleep 1
done
echo "[fake] backend 30s 沒回應 — 看 ~/.vibe-pipeline/server.log"
exit 1

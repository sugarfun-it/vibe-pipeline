---
description: 切到 enduser install stack — backend 從 ~/.vibe-pipeline/current 起,單 process serve API + dist/(port 3001)
---

# /prod — switch to enduser install stack

backend cwd = `~/.vibe-pipeline/current`,模擬 enduser 拿到 GitHub release tarball 的狀態(`vbpl update` 拉新版進這 dir)。跟 `/dev` 共享 global `~/.vibe-pipeline/server.json`(只能一個 backend 跑 :3001,切 stack = 殺舊起新)。

**本 command 不做更新**,只切 stack;要拉最新 release 用 `vbpl update`。

## 執行

shim path 自動判平台(Windows = `.cmd`,POSIX = bare):

1. **停現役 backend + 清 :3001**(graceful 走 enduser shim;force-kill 兜底):
   ```bash
   SHIM=$HOME/.vibe-pipeline/bin/vbpl; [ -f "$SHIM.cmd" ] && SHIM=$SHIM.cmd
   "$SHIM" server stop 2>&1
   python -c "import subprocess;subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort 3001 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'],capture_output=True)"
   ```

2. **起 enduser backend**(shim → server.json `repo_path` 寫 `~/.vibe-pipeline/current`):
   ```bash
   SHIM=$HOME/.vibe-pipeline/bin/vbpl; [ -f "$SHIM.cmd" ] && SHIM=$SHIM.cmd
   "$SHIM" server start 2>&1
   sleep 2
   ```

3. **verify**(任一 fail 就排雷):
   ```bash
   curl -fsS http://localhost:3001/api/health
   curl -fsS -o /tmp/r.html -w "GET /                status=%{http_code} ct=%{content_type} size=%{size_download}\n" http://localhost:3001/
   curl -fsS http://localhost:3001/api/system/version
   python -c "import json,pathlib,sys; from pathlib import PurePath; d=json.loads(pathlib.Path.home().joinpath('.vibe-pipeline','server.json').read_text()); p=PurePath(d['repo_path']).as_posix().lower(); print('repo_path:',d['repo_path']); sys.exit(0 if p.endswith('.vibe-pipeline/current') else 1)"
   ```

## 報告

- backend pid + `current` version(= enduser 安裝的 release tag)
- server.json `repo_path` 確認 = `~/.vibe-pipeline/current`

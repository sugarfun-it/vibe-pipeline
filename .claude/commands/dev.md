---
description: 切到 dev clone stack — backend 從本 repo 起,單 process serve API + dist/(port 3001)
---

# /dev — switch to dev clone stack

backend cwd = 本 git repo(`git rev-parse --show-toplevel`),改 server / cli source restart 即生效;改 src/ rebuild dist/ + reload PWA 即生效。跟 `/prod` 共享 global `~/.vibe-pipeline/server.json`(只能一個 backend 跑 :3001,切 stack = 殺舊起新)。

## 執行

1. **停現役 backend + 清 :3001**(graceful 走 dev clone cli,沒 PATH 依賴;force-kill 兜底):
   ```bash
   cd "$(git rev-parse --show-toplevel)" && bun run cli/vbpl.ts server stop 2>&1
   python -c "import subprocess;subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort 3001 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'],capture_output=True)"
   ```

2. **rebuild dist/**(失敗 abort,別進 step 3):
   ```bash
   cd "$(git rev-parse --show-toplevel)" && bun run build 2>&1 | tail -6
   ```
   沒看到 `files generated` + `dist/firebase-messaging-sw.js`(PWA 段尾)→ 排雷,別繼續。

3. **起 dev clone backend**(顯式 cli 不走 shim → server.json `repo_path` 寫 dev clone):
   ```bash
   cd "$(git rev-parse --show-toplevel)" && bun run cli/vbpl.ts server start 2>&1
   sleep 2
   ```

4. **verify**(任一 fail 就排雷,不報「成功」):
   ```bash
   curl -fsS http://localhost:3001/api/health
   curl -fsS -o /tmp/r.html -w "GET /                status=%{http_code} ct=%{content_type} size=%{size_download}\n" http://localhost:3001/
   curl -fsS http://localhost:3001/api/system/version
   python -c "import json,pathlib,sys,subprocess; from pathlib import PurePath; d=json.loads(pathlib.Path.home().joinpath('.vibe-pipeline','server.json').read_text()); repo=subprocess.check_output(['git','rev-parse','--show-toplevel'],text=True).strip(); p=PurePath(d['repo_path']).as_posix().lower(); expected=PurePath(repo).as_posix().lower(); print('repo_path:',d['repo_path']); print('expected:',repo); sys.exit(0 if p==expected else 1)"
   ```

## 報告

- backend pid + `current` version(API 實際回傳值;dev clone 會自帶 `dev-` prefix,如 `dev-v0.2.0-5-g3d67a9a-dirty`,base tag + ahead 數 + 短 hash + dirty 標記)
- server.json `repo_path` 確認 = 本 git repo 路徑
- 後續工作流:server / cli 改 → `bun run cli/vbpl.ts server restart`;src/ 改 → `bun run build` + browser hard reload

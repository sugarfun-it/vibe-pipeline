---
description: 切到 dev clone stack(backend 從 D:\sugarfungit\vibe-pipeline 起,改 source 隨 build 隨生效)
---

# /dev — switch to dev clone stack

切到「改 VP source code」的環境。Backend 從 `D:\sugarfungit\vibe-pipeline` 起,單一 process 同時 serve API + dist/ PWA(port 3001)。改 src/ 後 rebuild dist/ 即生效。

## 步驟

1. **停現役 backend**(任何 pid on 3001):
   ```bash
   vbpl server stop 2>&1
   ```
   force kill 備援:
   ```bash
   python -c "import subprocess;subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort 3001 -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'],capture_output=True)"
   ```

2. **rebuild dev clone dist/**(backend serve 的是 dist/,改 src/ 要 rebuild):
   ```bash
   cd D:/sugarfungit/vibe-pipeline && bun run build 2>&1 | tail -3
   ```

3. **起 dev clone backend**(cwd = dev clone,server.json 寫指 dev clone path):
   ```bash
   cd D:/sugarfungit/vibe-pipeline && bun run cli/vbpl.ts server start 2>&1
   sleep 2
   ```

4. **verify**:
   ```bash
   curl -s http://localhost:3001/api/system/version
   curl -s -o /dev/null -w "html=%{http_code}\n" http://localhost:3001/
   curl -s http://localhost:3001/api/health
   ```
   預期:`/` 回 200 + HTML、`/api/health` ok=true、`/api/system/version` 回 JSON、server.json `repo_path` 指 dev clone。

## 報告

回給 user:
- dev backend pid + version(`dev-vX.Y.Z`)
- server.json repo_path
- 改 source 後:server / cli 改完 `vbpl server restart`;src/ 改完 `bun run build` 再 reload PWA。

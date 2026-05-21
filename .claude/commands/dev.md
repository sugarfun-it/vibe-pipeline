---
description: 切到 dev clone stack(backend + vite 從 D:\sugarfungit\vibe-pipeline,改 source 隨改隨生效)
---

# /dev — switch to dev clone stack

切到「改 VP source code」的環境。Backend 跟 vite preview 都從 `D:\sugarfungit\vibe-pipeline` 起 — 改 server/ / cli/ / src/ 後直接 restart 就生效(不必走 release / install)。

## 步驟

1. **停現役 backend**(任何 pid on 3001):
   ```bash
   vbpl server stop 2>&1
   ```
   force kill 備援:
   ```bash
   python -c "import subprocess;subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort 3001 -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'],capture_output=True)"
   ```

2. **停現役 vite preview**(任何 pid on 4173):
   ```bash
   python -c "import subprocess;subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort 4173 -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'],capture_output=True)"
   ```

3. **rebuild dev clone dist/**(改 src/ 後 vite preview 才會 serve 新 bundle):
   ```bash
   cd D:/sugarfungit/vibe-pipeline && bun run build 2>&1 | tail -3
   ```

4. **起 dev clone backend**(cwd = dev clone,server.json 寫指 dev clone path):
   ```bash
   cd D:/sugarfungit/vibe-pipeline && vbpl server start 2>&1
   sleep 2
   ```

5. **起 vite preview**(serve dev clone dist/):
   ```bash
   cd D:/sugarfungit/vibe-pipeline && bun run preview > /tmp/vite-dev.log 2>&1 &
   sleep 2
   ```

6. **verify**:
   ```bash
   curl -s http://localhost:3001/api/system/version
   curl -ks -o /dev/null -w "vite=%{http_code}\n" http://localhost:4173/
   ```

## 報告

回給 user:
- dev backend pid + version(`dev-vX.Y.Z`)
- vite preview pid + serving path
- 改 source 後:server 端 `vbpl server restart` / frontend 端 `bun run build` + reload PWA

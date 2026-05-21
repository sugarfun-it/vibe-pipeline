---
description: 切到 enduser install stack(backend 從 ~/.vibe-pipeline/current,vite preview serve current/dist,模擬 user 看到的 release artifact)
---

# /prod — switch to enduser install stack

切到「跑 release artifact」的環境(模擬 user 看到的版本)。Backend 從 `~/.vibe-pipeline/current/` 起,vite preview 從 dev clone 借 vite 但指向 enduser 的 dist。

## 步驟

1. **停現役 backend**(任何 pid on 3001):
   ```bash
   vbpl server stop 2>&1
   ```
   若 stop 沒成功(server.json 指向 dev clone 但實際跑 enduser,或反過來),force kill:
   ```bash
   python -c "import subprocess;subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort 3001 -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'],capture_output=True)"
   ```

2. **停現役 vite preview**(任何 pid on 4173):
   ```bash
   python -c "import subprocess;subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort 4173 -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'],capture_output=True)"
   ```

3. **起 enduser backend**(via shim,讀 `~/.vibe-pipeline/current/`):
   ```bash
   ~/.vibe-pipeline/bin/vbpl.cmd server start 2>&1
   sleep 2
   ```

4. **起 vite preview 指向 enduser dist/**(用 dev clone 的 vite binary,因 enduser 沒裝 vite):
   ```bash
   cd D:/sugarfungit/vibe-pipeline && bunx vite preview --outDir ~/.vibe-pipeline/current/dist --port 4173 > /tmp/vite-prod.log 2>&1 &
   sleep 2
   ```

5. **verify**:
   ```bash
   curl -s http://localhost:3001/api/system/version
   curl -ks -o /dev/null -w "vite=%{http_code}\n" http://localhost:4173/
   ```

## 報告

回給 user:
- enduser backend pid + current version
- vite preview pid + serving path
- Tailscale URL 應仍 work(https://nb-24-001.tail67b6ba.ts.net/)

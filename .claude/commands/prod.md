---
description: 切到 enduser install stack(backend 從 ~/.vibe-pipeline/current 起,單一 process serve API + dist/,模擬 user 看到的 release artifact)
---

# /prod — switch to enduser install stack

切到「跑 release artifact」的環境(模擬 user 看到的版本)。Backend 從 `~/.vibe-pipeline/current/` 起,單一 process 同時 serve API + dist/ PWA(port 3001)。

## 步驟

1. **停現役 backend**(任何 pid on 3001):
   ```bash
   vbpl server stop 2>&1
   ```
   若 stop 沒成功,force kill:
   ```bash
   python -c "import subprocess;subprocess.run(['powershell.exe','-Command','Get-NetTCPConnection -LocalPort 3001 -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }'],capture_output=True)"
   ```

2. **起 enduser backend**(via shim,讀 `~/.vibe-pipeline/current/`):
   ```bash
   ~/.vibe-pipeline/bin/vbpl.cmd server start 2>&1
   sleep 2
   ```

3. **verify**:
   ```bash
   curl -s http://localhost:3001/api/system/version
   curl -s -o /dev/null -w "html=%{http_code}\n" http://localhost:3001/
   curl -s http://localhost:3001/api/health
   ```
   預期:`/` 回 200 + HTML(從 `~/.vibe-pipeline/current/dist/index.html`)、`/api/health` ok=true。

## 報告

回給 user:
- enduser backend pid + current version
- server.json repo_path(應指 `~/.vibe-pipeline/current`)
- Tailscale URL 應仍 work(https://nb-24-001.tail67b6ba.ts.net/)

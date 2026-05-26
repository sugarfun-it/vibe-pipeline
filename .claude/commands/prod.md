---
description: 切到 enduser install stack — backend cwd = ~/.vibe-pipeline/current
---

# /prod — switch to enduser install stack

bash 跑 `bash .claude/commands/prod.sh`,~2s 完成(idempotent skip / poll-until-up / tailscale forward 同步)。

模擬 enduser 拿到 GitHub release tarball 的狀態(`vbpl update` 拉新版進 `~/.vibe-pipeline/current/`)。**本 command 不做更新**,只切 stack;要拉最新 release 用 `vbpl update`。

## 報告

- backend pid + `current` version(= enduser 安裝的 release tag)
- server.json `repo_path` = `~/.vibe-pipeline/current`
- backend 實際 port(若非 3001,代表 EADDRINUSE fallback)
- Tailscale serve target(若 tailscale CLI 在 PATH)= 同 backend port

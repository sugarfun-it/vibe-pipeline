---
description: 切到 dev clone stack — backend cwd = git root,改 src/ rebuild dist/ 即生效
---

# /dev — switch to dev clone stack

bash 跑 `bash .claude/commands/dev.sh`,~2s 完成(idempotent skip / src→dist mtime check / poll-until-up)。

跟 `/prod` 共享 global `~/.vibe-pipeline/server.json`(只能一個 backend 跑,切 stack = 殺舊起新)。

## 報告

- backend pid + `current` version(dev clone 自帶 `dev-` prefix,如 `dev-v0.2.4-1-g3d67a9a-dirty`)
- server.json `repo_path` = 本 git repo
- 後續工作流:server / cli 改 → `bun run cli/vbpl.ts server restart`;src/ 改 → `bun run build` + browser hard reload

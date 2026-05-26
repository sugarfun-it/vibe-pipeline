---
description: 把 install layout 的 package.json 假成舊版,測 PWA 立即更新 flow,不必跑 /release
---

# /fake <version> — patch install layout 假版本

bash 跑 `bash .claude/commands/fake.sh <version>`,例:`bash .claude/commands/fake.sh 0.2.0`。

## 用途

製造「本機 < GH latest」假狀態給 maintainer 測 PWA 立即更新 flow:fake → PWA Settings 「更新」tab 出現「立即更新」按鈕 → 點 → install.ps1 / install.sh 跑 → 結束時 backend 報真實版本(install 蓋掉假版本)。

## 限制

- 只對 install layout 有意義(`~/.vibe-pipeline/current`)。dev 模式 backend 版本走 git describe,假 `current/package.json` 不影響
- script 先 check `server.json` 的 `repo_path`,不在 install layout 直接 exit 並建議先跑 `bash .claude/commands/prod.sh`

## 副作用

- 改 `~/.vibe-pipeline/current/package.json` 的 `version` field
- restart backend
- 下次跑 install(PWA 立即更新 / `vbpl update`)會自動蓋回正常版本,不必手動 unfake

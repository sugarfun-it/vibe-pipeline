# refs

設計文件 / 競品對照 / 歷史 spec。maintainer 用,enduser 不裝。新加 ref 寫進本資料夾 + 下方對應分類加列;落地 / 不再參考時搬 `archive/`。

分類:**不變約定**(現行規則,改 code 對齊)/ **待動工規格**(對應 TODO,動工前讀)/ **postmortem / 引用中**(已 ship 但仍被 prod code / TODO 引用)。

## 不變約定 / SSOT

| 檔 | 用途 |
|---|---|
| [`repo-structure.md`](repo-structure.md) | Repo 物理檔案 / 目錄結構 single source of truth |
| [`enduser-install-update-design.md`](enduser-install-update-design.md) | enduser tarball install + Settings 一鍵 update 設計(install.sh/ps1 + updater.ts) |

## Postmortem / 引用中

| 檔 | 用途 |
|---|---|
| [`pause-simplify-run-postmortem-2026-05-17.md`](pause-simplify-run-postmortem-2026-05-17.md) | pause 簡化的 8 bug postmortem(已全 ship,TODO 已落地段引用) |

## Archive

`archive/` 下(歷史 / 已落地 / 已 revert / 已放棄):

- phase 計畫(`integration-plan-v1` / `-v2-qa` / `-v3-runner-2026-05-10`)— 全落地
- `spec-2026-05-09.md` — 初版產品 spec,Phase 1-5 已實作,P2/P3 在 TODO
- `state-matrix-2026-05-10.md` — Pipeline state × condition → UI 決策表(pause-simplify 拔 stopping 後部分過時)
- `git-design-2026-05-09.md` — worktree 設計已實作
- `sync-redesign-2026-05-13.md` — Sync 重構(Plan C)已 ship,backend SKILL 仍引用脈絡
- `claude-cli-spawn-perf-2026-05-11.md` — claude CLI spawn flag 量測,改動已 merge,prod code 仍引用 rationale
- `pause-simplify-2026-05-17.md` — pause graceful 拔除的 7-ticket spec 已執行
- `settings-pwa-tab-redesign-2026-05-17.md` — PWA tab 重排已 ship,baseline 保留
- `settings-redesign-2026-05-17.md` — Settings full redesign 實作後 2026-05-18 全 revert
- `board-redesign-2026-05-17.md` — board redesign mockup-driven pipeline 跑歪未 merge,放棄
- `skill-injection-2026-05-14.md` — 「引用重點 SKILL」設計,廢案
- `vbpl-server-cmd-2026-05-17.md` — `vbpl server start/stop/status/restart/logs` CLI 包裝,2026-05-19 phase8 落地
- `fcm-push-gateway-2026-05-17.md` — FCM push 共用方案(maintainer host gateway),2026-05-19 fcm-gateway pipeline 落地(gateway 部署 Cloud Run asia-east1 + backend 拔 firebase-admin)
- `merge-isolation-2026-05-11.md` — self-dogfood AI merge 撞 watch 研究,結論不投(等 VP fork 變多 + user 抱怨累積再回頭)
- `worktree-env-2026-05-15.md` — `.worktreeinclude` 慣例(已落地)+ plan B merge 前 secret 偵測(2026-05-19 決定不做,scope creep)
- 競品對照合集(`composio-ao` / `symphony` / `torque` / `vibe-kanban`,設計初期一次性參考)

`competitor-refs.md` 在 `refs/`(非 archive)是上述四份競品的合集索引。

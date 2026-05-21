# TODO

Phase 8 候選清單。動工時搬進 pipeline ticket(`vbpl ticket add --pipeline 019e36fbea63-phase8`),完成或落地搬掉。

新項加底下,寫進對應 ref doc 後加 link。

### 1. iOS PWA push 實測
- iOS 16.4+ 已支援 Web Push 但需先「加入主畫面」,目前只在 Android 驗過
- 沒獨立 ref(<1 條 ticket),動工時直接拆

---

## Session 新痛點(規格待寫)

### 2. Runner process lifecycle ↔ pipeline state 整體 reconciliation
- 共同根因:VP backend 有 3 個 state source 不同步:
  - backend in-memory `running` Map
  - spawned codex / claude children(detached process tree,跨 backend restart)
  - disk `pipeline.json`(主 agent / ticketWatcher 寫)
  各自不知對方狀態 → 各種邊角。**該整體設計**,獨立修易互相打架。
- 痛點 4 個面向:
  - **A. backend wedged 但 port 還占**(撞過 PID 90740,3001 listening 卻 health timeout)
  - **B. runner 主 agent 自宣告完成 + process tree 自殺,backend 沒收到 exit signal,pipeline state 卡 "running"**(phase8 run 撞過,要 user 手動 `vbpl pipeline stop` 才能重 run)
  - **C. backend restart `recoverStale` 太武斷標 `failed_transient`**(其實 orphaned codex children 可能還活,實證 settings-pixel-polish 01:39:07 標 failed_transient → 01:48:28 ticketWatcher disk reconcile 救回)
  - **D. ticketWatcher disk reconcile 是 happy accident**(目前靠 fs.watch 從 disk 反推 backend memory state 救場,未正式設計化)
- 候選機制(整套設計):
  - watchdog tick 探 PID alive + `/api/health` timeout + log mtime → 死才標 transient
  - orchestrator spawn 結束必有 cleanup callback,不靠 child 自殺通知 backend
  - `recoverStale` 改精準:PID alive check + log mtime 真死才標 failed_transient
  - ticketWatcher 設計化 OR 反向砍 detached children(backend restart 必殺 codex 子 process tree,不留 disk reconcile 救場 path)
- 規格待寫,動工前要決:設計化 ticketWatcher 還是砍 detached?(影響整體 architecture)
- YAGNI 評估:目前 dogfood 偶踩,等再痛或 enduser 多了再動

### 4. Critic 全局視角強化 — 防 doer 執行時硬解(2026-05-22 討論)

- 痛點:現有 critic 只看「acceptance 過嗎」,**不看「方向 / scope / layer 對嗎」**。doer 在 ticket 內硬解錯誤方向時(e.g. 該動 B 卻在 caller A 加 workaround;該砍舊元件卻多加新元件),critic 看 acceptance 通就 PASS 放行 → auto-merge 把錯誤 bake 進 main
- 上游 strategic 拆 ticket 錯,獨立議題(本質單點失敗,加 review checkpoint 解);**本 TODO 只處理執行時 critic 不察的部分**
- 估可 cover ~70%(根因在 callee 卻補 caller / 違反 CLAUDE.md 雷區 / 違反 SKILL.md 慣例 / 跟相鄰 ticket 衝突 / duplicate 已有元件)
- cover 不到:user 心裡未明說的 strategic 偏好、需 user 授權的範圍、短期 vs 長期 tech debt 取捨
- 設計方向(prompt 工程級,不必動 orchestrator):
  - critic system prompt 二段式:**先評 acceptance,再評 scope / layer 合不合理**
  - critic 主動 read 全域參考(`.claude/rules/`、相關 SKILL、call graph 上下游、同 pipeline 其他 tickets)
  - 新 verdict 類別 `scope_concern`(非 PASS/FAIL 二分,要 doer 解釋 / 改方向)
  - doer 解釋「正解超 user 授權」→ critic 寫 `SCOPE_ESCALATION.md` 讓 user 在 PWA 看到決策點
- 風險:critic over-fire(false positive)→ doer 多耗 1-2 輪;critic 全局判斷自己也可能錯。比 merge 錯了再 revert 仍便宜
- 落點:`server/lib/runner/runnerPrompt.ts` critic 段 + `server/lib/runner/orchestrator.ts` 加 `scope_concern` 分支處理
- 同樣問題也存在主 agent 派 Task sub-agent(無 critic 全靠 user review);本 TODO 先解 VP path,Task 路徑靠紀律
- 規格待寫;先補 ref doc 拆設計細節

### 3. Web UI 不該自動 fire `pipeline.run`(monitor only)
- 痛點:settings-pixel-polish audit log 記到兩次 `user_action pipeline.run`(00:21:58 + 01:23:41)而 user 確認沒按
- **2026-05-19 調查結論**:src/ 全 grep + backend internal caller / SW POST cache / fetch retry middleware 全排查,**找不到 auto-fire code path**(唯一 caller 是 RunButton onClick)。最一致解釋:user 自己按了忘記,或 vbpl CLI 從別處呼(以前 audit 無法區分 cli vs browser)
- **2026-05-19 已加 instrumentation**(`1526488`):audit user_action 加 `via` 欄(cli / browser / other),vbpl CLI 自帶 `User-Agent: vbpl-cli`,backend `detectVia(req)` 讀 UA 寫 audit
- 現狀:monitor only。下次再撞「user 沒按但 audit 抓到」直接看 audit `via` 欄秒判 source
- **真撞到**(via=browser 而 user 確定沒按)再開正式 ticket 深挖


---

## 工作流

1. 想動哪項 → `vbpl ticket add --pipeline 019e36fbea63-phase8 --title "phase8: <X>" --mode iter --goal "..." --prompt "..."`
2. 規格未寫的(2-3)先寫 ref → 落 ticket
3. 完成搬掉本檔,合進 CHANGELOG / 雷區 / SKILL

---

## 已落地(搬離 active 清單)

- ~~vbpl server start/stop/status/restart/logs~~ — phase8 t1-t4 落地(d1ec87c,2026-05-19)
- ~~vbpl pipeline delete cascade~~ — phase8 t6 落地(d1ec87c)
- ~~RunHistory 加失敗原因 + ticket 進度 + codex 隱藏空欄~~ — phase8 t5 落地(d1ec87c)
- ~~runner 主 agent 每輪重讀 pipeline.json~~ — b096cc8 落地
- ~~FCM push gateway~~ — fcm-gateway pipeline t1-t5 落地(2026-05-19);Cloud Run asia-east1 / Firestore per-token registry / max-instances=1 / $1 budget alert / backend 拔 firebase-admin 改 POST gateway(hard cutover)。ref → [`refs/archive/fcm-push-gateway-2026-05-17.md`](refs/archive/fcm-push-gateway-2026-05-17.md)
- ~~pause-simplify 8 follow-up bug~~ — 2026-05-19 verify 後全 ship。B1-B5 已落地 / B6-B7 pause-simplify 主軸已 ship / B8 phase8 t5 順手覆蓋 / B9 = TODO #2 runner lifecycle。ref → [`refs/pause-simplify-run-postmortem-2026-05-17.md`](refs/pause-simplify-run-postmortem-2026-05-17.md)
- ~~Merge 前 secret 洩漏偵測~~ — 2026-05-19 決定不做(scope creep)。`.worktreeinclude` 第一層已落地(消除 AI hardcode 誘因);plan B 自製 secret scanner 越界(VP 是 pipeline orchestrator,不該管 user repo 安全)。建議 user 自己裝 gitleaks pre-commit hook(廣 pattern + 業界標準)。ref → [`refs/archive/worktree-env-2026-05-15.md`](refs/archive/worktree-env-2026-05-15.md)

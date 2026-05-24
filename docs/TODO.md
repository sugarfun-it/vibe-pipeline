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

### 6. Primitive ownership cleanup — Popover / form-field 共用元件職責邊界

- 2026-05-24 iter-uiux 6 輪 review SettingsPopover + Rail + OverflowMenu 後浮出的設計系統成熟度議題:T4-T11 refactor 把 overlay / popover / form primitive 拉出來,但 consumer 端的舊 CSS 沒同步清乾淨,跟 primitive 內部邏輯打架。已撞過至少 3 次 regression:
  - **r5**: `.focus-overflow-menu` 留 `position: absolute; right: 0;` 跟 Popover JS-computed `left` 打架 → menu 拉伸到 viewport 邊
  - **r6**: 修 r5 順手把 `z-index: 1000` 一起刪 → Popover portal 沒 z-index 被頁面 stacking 蓋
  - **r3**: `.form-field { width: 100% }`(forms.css)蓋過 `.settings-form-field { width: auto }` → input wrapper 撐滿欄寬擠掉 inline-unit
- 共通根因:**primitive 對「自己該負責什麼」沒講清楚**,consumer 還自己處理位置 / 寬度 / z-index 等,加新 consumer 就重複踩雷
- 範圍(本 ticket 處理):
  1. **Popover 自己負責 z-index** — primitive 該設,不該散在 8 個 `.xxx-menu` class。可走 `--popover-z` CSS var on root,或 Popover 內加 wrapper class `.popover-surface` 帶 z-index;React `CSSProperties` 對 CSS var string 不友善要 cast hack,所以走 CSS class 比 inline style 乾淨
  2. **拆 `.focus-overflow-menu` 職責** — 一份共用 `.menu-surface`(背景 / 邊框 / 陰影 / 內距),consumer 各自 `.xxx-menu` 只放 size / variant。**禁設 position / top / right / left**(注釋 + lint?)
  3. **`.form-field` 跟 `.settings-form-field` width 衝突** — 系統化處理:form primitive 提供 `inline` / `block` variant prop,不靠 consumer 用 specificity 蓋
  4. **settings field group primitive** — codex round 3 P3-08 / round 2 P3-04 都提過:`.settings-field-row` + label col 寬度 + hint 對齊 + mobile stack 重複出現在 ProjectTab / AITab / NotificationsTab / UpdateTab。抽成 `<SettingsField label="..." hint="...">` component
  5. **audit 其他 primitive** — Overlay / TextField / NumberField / PickerSelect 各自有沒有類似 consumer 端 stale CSS leak
- 落點:`src/ui/Popover.tsx` / `src/ui/forms/forms.css` / `src/features/pipeline/focus.css` / 新增 `src/ui/menu/menu.css`(or 類似)/ 新增 `src/ui/forms/SettingsField.tsx`
- 規模:中(~5 個檔變動,~15 處 consumer 改),iter 模式 critic 多輪查 visual regression
- 風險:動既有共用 class 會波及多處(Rail / OverflowMenu / SettingsPopover / 各 Settings tab)— ship 前要全 popover 開一遍 + 全 settings tab 切一遍人工 visual 驗
- **2026-05-24 iter-uiux Phase 4 補加項**(同一根因):
  - **Overlay primitive rename + ref-counted scroll-lock** — 6 個 overlay caller 各自 inert / scroll-lock 自己管,沒中央 ref-count → 多重 overlay open 時 race。primitive 該擁有
  - **toggle-pill iOS-switch 重設計** — 目前 `.toggle-pill` 在 disabled / off 之間視覺難分,Phase 4 只加 scope hack;真解是換 native iOS-switch pattern(track / thumb / labels 對齊),全 app `.toggle-pill` consumer 跟著改
  - **OverflowMenu copy migration to `descriptionRich`** — ConfirmDialog 在 Phase 4 加了 `descriptionRich?: ReactNode` API,但 OverflowMenu 內部 confirm 還用舊 string 字串,沒享 rich text(粗體 / 行高 / icon)— 屬 primitive consumer migration

### 7. EmptyProject CTA → 提升 shared context

- 痛點:`EmptyProject` 的「選擇專案資料夾」CTA 直接呼叫 `setBrowseOpen` — 但這個 state owner 在 TopBar 內,EmptyProject 沒法直接 trigger,目前是 deferred 沒接線
- 2026-05-24 iter-uiux Phase 4 揭露(`empty-project` unit)
- 設計方向:
  - 把 `browseOpen` / `setBrowseOpen` 從 TopBar local state 升到 `ProjectPickerContext`(新建)
  - TopBar 跟 EmptyProject 都從 context 拿,EmptyProject CTA 直接可開 browse modal
  - 順手把 browse modal JSX 也搬出 TopBar(目前 inline 在 TopBar.tsx 內 ~150 行),改成自己 component
- 落點:新建 `src/contexts/ProjectPickerContext.tsx`、抽 `src/features/pipelineCreate/BrowseProjectModal.tsx`、改 `TopBar.tsx` + `EmptyProject.tsx` 兩 consumer
- 規模:小-中(~3 個 new files、~2 個改),step ticket 即可
- 風險:browse modal 內部有 keyboard / focus / fetch loading state,搬家時 e2e 要重跑

### 8. i18n message-table 抽 ~50 strings

- 痛點:全 app 散佈硬寫繁中字串,沒 message-table 層 → 任何 copy 改要 grep + 多檔同步;遠期想支援英文 / 簡中也卡在這步
- 2026-05-24 iter-uiux 多輪反覆指出(多個 unit deferred 含 i18n-001 等)
- 估規模:~50 visible strings(各 unit changelog 散落估)— 中型 sprint
- 設計方向:
  - 走 lightweight i18n(不用 react-intl / i18next,避免 bundle bloat)— 自寫 `src/i18n/messages.ts` 一個物件 + `t(key)` helper
  - 命名 namespace:`pipeline.*` / `ticket.*` / `qa.*` / `settings.*` / `auth.*` 等
  - 初期只繁中,key 名用英文 → 之後加 zh-CN / en 直接新 messages file
- 子議題:**verdict glyph 在地化 audit**(`✓` `✗` `?` 等符號用 ASCII 或 unicode 對 SR / 中文 narrator 唸法差很多,要決定保留 unicode 還是改文字)
- 落點:新建 `src/i18n/`、全 ~50 處 hard-coded string callsite 改 `t(...)`
- 規模:中(~50 處 callsite),iter 模式 critic 多輪查 copy diff
- YAGNI 評估:VP 是 maintainer + 中文 enduser only,英文化沒急;主要好處是 copy 改集中。可緩

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
- ~~Runner + QA spawn 限制鬆綁:MCP + slash commands 拿掉~~ — 2026-05-23 ship。`claudeAdapter.ts` spawnRunner / spawnQA 拿掉 `--strict-mcp-config` + `--mcp-config` + `--disable-slash-commands`。Runner / QA 現在能用 user 配的 MCP(codegraph)+ `superpowers:*` / project skill;QA 仍禁 Edit/Write/Task。Split / codex path 不動。
- ~~Merge 前 secret 洩漏偵測~~ — 2026-05-19 決定不做(scope creep)。`.worktreeinclude` 第一層已落地(消除 AI hardcode 誘因);plan B 自製 secret scanner 越界(VP 是 pipeline orchestrator,不該管 user repo 安全)。建議 user 自己裝 gitleaks pre-commit hook(廣 pattern + 業界標準)。ref → [`refs/archive/worktree-env-2026-05-15.md`](refs/archive/worktree-env-2026-05-15.md)

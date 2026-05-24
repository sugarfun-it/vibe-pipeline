---
name: vibe-pipeline-e2e
description: vibe-pipeline E2E 測試規範 — Playwright 雙模式(mock CI / real 手動)架構、覆蓋矩陣(project / pipeline / QA / ticket / runner / merge / notif / topbar / state guards)、mock 注入點、fixture project 生命週期、selector 策略。寫 / 改 / 跑 e2e 之前先讀;設計 backend 變動時對齊覆蓋矩陣是否需補測。
---

> repo 結構樹 / 開發環境 / 雷區 → root [`CLAUDE.md`](../../../CLAUDE.md)。本 SKILL 只寫 e2e 領域的決策與約定。

## 一句話定位

E2E 用 Playwright 跑真瀏覽器 + 真 backend,**不靠 unit test 取代**。phase 3 砍掉 prototype + pixel-diff 後重新建,目標**完整覆蓋所有 user flow**(列在 § 覆蓋矩陣)。

## 現況

mock spec + real 套 `vp-autotest` iter ticket 驗證。缺覆蓋:FCM fanout(需 mock FCM Admin SDK)/ RWD breakpoint / autoMerge / splitInto / sync / prune worktree / Settings 4-tab。Phase 進度 → [`CHANGELOG.md`](../../../docs/CHANGELOG.md)。**Auth(TOTP)e2e 已於 2026-05-24 隨 auth feature 拔除一併刪除**。

## 雙模式

|  | mock 模式 | real 模式 |
|---|---|---|
| 觸發 | `VP_TEST_MODE=mock`(預設) | 不設 env |
| claude CLI | in-process fake,canned reply schedule | 真 spawn,真燒 token |
| runner spawn | in-process fake,模擬 ticket 狀態時間軸 | 真 claude session + sub-agent |
| 用 project | tests/fixtures 建立的 temp git repo | `d:/sugarfungit/vp-autotest`(hash `cf94d1b2`) |
| 跑哪 | CI(快、穩、免費) | 手動觸發,釋出前驗證 |
| spec dir | `tests/e2e/mock/*.spec.ts` | `tests/e2e/real/*.spec.ts` |
| config | `playwright.config.ts` | `playwright.real.config.ts` |
| script | `bun run test:e2e` | `bun run test:e2e:real` |

**Mock 不是 stub 玩具** — 必須跑真 vite + 真 bun server,只 fake spawn 那一層。前端 / route / state 機 / fs 寫入 / notif emit / fs.watch / diff 偵測 全要照常運作。Mock 只負責「生成 fake stdout」+「按時間軸寫 pipeline.json 模擬 runner 進度」。

## 執行架構

```
┌─ Playwright (Chromium) ────────────────────┐
│  test code → 控制 UI                       │
└──────────┬─────────────────────────────────┘
           │ HTTP
           ▼
┌─ vite (5173) ──────────────────────────────┐
│  React app, 真 build 真 hydrate            │
└──────────┬─────────────────────────────────┘
           │ /api proxy
           ▼
┌─ bun server (3001) ────────────────────────┐
│  真 routes / 真 lib / 真 fs IO             │
│  ┌─ mock 模式才 mount: /api/__test/* ──┐   │
│  │  - POST /script/qa     設 QA 劇本   │   │
│  │  - POST /script/runner 設 runner    │   │
│  │  - POST /reset         清 mock 狀態 │   │
│  └────────────────────────────────────┘    │
│  claudeCli.runTurn / orchestrator.spawn    │
│   └─ if VP_TEST_MODE === "mock" → fake     │
└────────────────────────────────────────────┘
```

### Mock 注入點(只兩個)

1. **`server/lib/qa/claudeCli.ts:runTurn`** — 開頭判 `VP_TEST_MODE === "mock"` → 走 mock 分支:讀 in-memory `qaScript` 拿下一筆 reply 回傳。real 模式 spawn `claude` 不變。
2. **`server/lib/runner/orchestrator.ts:spawnRunner`** — 開頭同樣判,改不 spawn 真 process,而是 `setTimeout` 序列照 in-memory `runnerScript` 寫 pipeline.json(模擬 ticket draft → ready → running → done + iter rounds + commits)。real 模式不變。

兩個 mock state 都用 module-level `Map<projectHash, Script>` 存,由 `/api/__test/script/*` 寫入。Mock fs 寫入照常用 atomic write,fs.watch 照常 emit notif → 全鏈路通。

### Fixture project 生命週期

- **每 spec file 一個 tmpdir**(`os.tmpdir()/vp-e2e-<random>/`),beforeAll 建,afterAll rm -rf
- 建立步驟:`mkdir + git init + .vibe-pipeline/config.json` 寫初始內容 + 預先 add/commit 一個 dummy file 確保有 base branch
- 透過 `POST /api/__test/register-project` 把 path 註冊進 `~/.vibe-pipeline/state.json`(test mode 用獨立的 home,見 § 隔離)
- 進 UI 後用 URL `?project=<hash>` 直接導向

### 隔離

- `VP_TEST_MODE=mock` 同時設 `HOME=<tmpdir>` 讓 `~/.vibe-pipeline/` 也走 temp,不污染 user 真 state
- worktree 也跟著走 fake home,自然隔離
- 每個 test file `beforeAll` 用獨立 port range 避免 parallel 撞(playwright `workers: 1` 起步,穩定後再加)

## 覆蓋矩陣

每塊都要有對應 spec。**新增 backend / frontend feature 要回來檢查這表是否需補測**。

### Mock 模式(CI 全跑)

| 模組 | flow | spec file |
|---|---|---|
| **Project** | 開資料夾(folder picker) → init → board 顯示 | `project-lifecycle.spec.ts` |
|  | 切 project(URL ?project= / recents dropdown) |  |
|  | localStorage fallback(URL 沒 project,讀 lastProjectHash) |  |
|  | hasGit=false → 顯示 git init CTA → 按 → hasGit=true |  |
|  | reveal worktree(mock OS picker call,只驗 endpoint hit) |  |
| **Pipeline CRUD** | create(CreateCard 名稱 + base branch picker) | `pipeline-crud.spec.ts` |
|  | rename inline ✎(escape 取消、enter 套用、重名擋) |  |
|  | delete(confirm flow,running 擋) |  |
|  | reset all done/failed |  |
|  | overflow menu(reveal worktree / 重跑全部 / 刪除) |  |
|  | empty state CTA(沒 pipeline 時顯示) |  |
| **QA flow** | 開 QADrawer → AI 開場 → 5 輪走完 → finalize → ticket 出現 | `qa-flow.spec.ts` |
|  | spec checklist 5/5 進度顯示 |  |
|  | multi-select option mode(picked + 送出多選) |  |
|  | mid-flow cancel(空 draft auto-cancel)→ draft 不留 |  |
|  | resume:關 drawer 重開 → 對話續上 |  |
|  | progress hint:user turns >=3 且 spec 不齊 → AI 強制自填(mock 劇本驗) |  |
| **Ticket drawer** | 點 ticket → 看 goal/acceptance/prompt/iter 概況 | `ticket-drawer.spec.ts` |
|  | iter rounds 明細(executor summary / critic verdict + feedback) |  |
|  | commits 列表 + click-to-copy hash |  |
|  | reset ticket(per-ticket,terminal status 才出現) |  |
|  | RunHistory 展開 stdout/stderr |  |
|  | Esc 關閉 |  |
| **Runner** | Run → state 變 ready → running → done(全 ticket done) | `runner-flow.spec.ts` |
|  | Stop(running → paused immediately; active ticket paused),resume 接續 |  |
|  | Stop state sequence: running → paused,無中介 state(無 `stopping` / 無 graceful 路徑) |  |
|  | RunButton 單按鈕 label 切換:idle/paused/failed → 開始/繼續/重試;running → 停止;**不出現雙按鈕或「停止中」chip** |  |
|  | iter mode FAIL → PASS chain(verdicts 寫 ["FAIL","PASS"]) |  |
|  | failed_iter_limit(達 iter 上限 + iterStopAtLimit=true → pause) |  |
|  | failed_transient(mock 劇本第一次擲、第二次成功) |  |
|  | auto-commit per done ticket(`ticket(<n>): <title>`,hash 回寫) |  |
|  | crash recovery:重啟 server → 看到 stale running → 標 paused |  |
|  | state guard:running 中按 Run → toast 擋 |  |
|  | RunButton 上次 duration 預估顯示 |  |
|  | FocusColumn 累計成本 chip |  |
| **Merge** | 全 ticket done → ReadyBanner Merge → squash 成功 → state=merged | `merge.spec.ts` |
|  | strategy:merge / squash / ff-only(走 config.defaults.merge_strategy) |  |
|  | 衝突 → abort + 錯誤 toast,state 不動 |  |
|  | merged 後按 Run → state guard 擋 |  |
|  | View diff 按鈕(reveal worktree) |  |
| **Notifications** | inbox panel:filter all/unread/blocking + count 對齊 | `notif.spec.ts` |
|  | inbox strip:pip 顯示 + overflow +N |  |
|  | bell 數字 + 無 unread 時不顯 |  |
|  | mark read / dismiss / mark all read |  |
|  | 點 notif → 跳該 pipeline + 該 ticket drawer 開啟 |  |
|  | sev block 沉降 muted(收合 strip) |  |
|  | log/notif GC(per-pipeline 留 10 / project 留 500) |  |
| **FCM Push** | token register → list / ticket done fanout → fake FCM call / unregister → gone | `fcm.spec.ts` |
| **TopBar / theme** | recents dropdown 切 project | `topbar.spec.ts` |
|  | folder picker via menu |  |
|  | ⌘O / Ctrl+O shortcut |  |
|  | theme toggle + localStorage 持久(reload 後仍 dark) |  |
|  | URL `?theme=dark` override |  |
|  | tab title 動態(running 時 `(N) <pipeline> 跑中 · vibe-pipeline`) |  |
| **State guards (backend via UI)** | savePipeline shape 缺欄位 → 4xx + UI 不變 | `guards.spec.ts` |
|  | running/queued 不准 PUT |  |
|  | PUT non-existent → 404 |  |
|  | QA close 自動 cancel 空 draft |  |
| **Empty states** | EmptyProject 箭頭指 TopBar + CTA | `empty.spec.ts` |
|  | empty pipeline 空狀態 CTA |  |
|  | actionError 右下 toast 顯示 + 自動消失 |  |

### Real 模式(手動,釋出前)

| flow | spec file |
|---|---|
| 開 vp-autotest 真 project,QA 走完一輪建 ticket(燒 ~$0.5) | `qa-real.spec.ts` |
| 跑 step ticket → done → commit 回 worktree | `runner-step-real.spec.ts` |
| 跑 iter ticket FAIL → PASS chain(燒 ~$1.5) | `runner-iter-real.spec.ts` |
| Multi-ticket pause/resume(燒 ~$1.5) | `runner-pause-real.spec.ts` |
| Merge squash 進 main(只在 vp-autotest 上) | `merge-real.spec.ts` |

real 模式跑前 user 要確認 vp-autotest 是乾淨狀態(無進行中 pipeline);spec 末尾不負責清理(留現場給 debug)。

### 外部依賴 probe(手動驗特定 fix,不進 CI)

不屬上述兩模式的特殊 probe:**故意打 user 真 stack**(真 backend 3001 + 真 vite 5173 + 真 active project + 預先存在的 pipeline state),驗某個視覺 / 效能類 fix 是否真的解了。**不能自動跑、CI 不要 invoke**。配獨立 config(不開 `webServer`),user 手動觸發。

|  probe | spec | config | 驗什麼 |
|---|---|---|---|
|  tab 切回 flicker | `tab-flicker-probe.spec.ts` | `tab-flicker.config.ts` | useApi 300ms dedupe(974811f)+ backend windowsHide(e73d772)真實生效 |

跑法:
```bash
# 前置:user backend 3001 + vite 5173 都活著,active project=1876248b 並至少有一個 paused pipeline
bunx playwright test --config=tests/e2e/tab-flicker.config.ts
```

寫新 probe 的約定:
- spec 名 `*-probe.spec.ts`,config 名 `<topic>.config.ts`,跟 mock/real 區隔
- config 不設 `webServer`(故意用 user 在跑的真 stack)
- 程式碼裡寫死 project hash / pipeline id 是 OK 的 — probe 不追求可移植,要忠實重現 fix 場景
- 留檔還是刪檔的判準:fix 的 repro 場景複雜到光看 commit message 重現會出錯 → 留;commit log 已說清楚 → 刪

## 寫 spec 的約定

### Selector 策略

- **首選 `data-testid`**(per page object 統一加一輪),不靠 text 因要支援 i18n / 重構
- 動態文字內容用 text 比對:狀態 chip(`執行中` / `完成`)、commit subject 等
- Rail item 用 `data-testid="rail-item-${pipelineId}"`
- 加 testid 時順便加到對應元件 — 不要散在 spec 內 hack `nth-child`

### 等待

- **不用 `waitForTimeout`**(flake 來源)
- 用 `expect(locator).toHaveText(...)` / `toBeVisible()` 自帶 retry
- polling 期(1.5s 抓 pipelines)等狀態變動用 `expect.poll()` 或 `toHaveAttribute("data-state", "running")`

### Fixture helper

`tests/e2e/helpers/`:
- `temp-project.ts` — `createTempProject({ pipelines?: Pipeline[] })` / `cleanupTempProject(handle)`
- `mock-control.ts` — `setQAScript(projectHash, replies[])` / `setRunnerScript(projectHash, timeline[])` / `resetMocks()`
- `page-objects/` — Rail / Board / QADrawer / TicketDrawer 各自一個 PO,封裝 selector + 常用動作

### 命名

- `<scope>.spec.ts`(snake-case 對齊既有 .ts 慣例,別 PascalCase)
- test name 中文 OK,要描述「行為 → 預期」:`test("running 中按 Run → 顯示擋住 toast", ...)`

## 雷區

1. **Mock 模式忘記設 `HOME` env** → 寫到 user 真 `~/.vibe-pipeline/state.json`,污染 production state。Playwright `webServer.env` 一定要設。
2. **fs.watch on tmpdir** Windows 行為跟 Linux 不同 — Windows 上 `recursive: true` 行得通但 emit 順序不保證。Spec 用 `expect.poll` 不要假設一定 1.5s 內到。
3. **Mock 劇本逐 turn 推進** — 不要寫成「跑完整套」一次回。QADrawer 看 turns.length 觸發 progress hint,要逐輪。
4. **runnerScript 模擬時序要寫 atomic write**(reuse `pipelineDir.savePipeline`),避免 fs.watch 看到半寫狀態。
5. **vite dev server 第一次啟很慢**(~3s)。`webServer.timeout: 30000` 起跳,別等預設 60s 卡 CI。
6. **Playwright HTML reporter 寫到 `playwright-report/`** — 加 .gitignore;screenshots/videos 也是。CI artifact 上傳處理。
7. **Real 模式 spec 不要 import mock helper**(會誤導 setQAScript 沒效果)— 兩套 helper 分開 dir。
8. **改 `runnerPrompt.ts` / `systemPrompt.ts` 影響 real 模式行為** — mock 不會炸但 real spec 會。改 prompt 後跑一輪 real spec 驗。
9. **Playwright 預設 retain trace 只在 retry 時** — debug 階段設 `trace: "on"` 看 timeline 比 console.log 快太多。

## 跑 / 裝 / debug

```bash
# 一次性 setup
bun add -D @playwright/test
bunx playwright install chromium

# 平常跑
bun run test:e2e               # mock 全套
bun run test:e2e -- crud       # 只跑 crud.spec.ts
bun run test:e2e -- --headed   # 開瀏覽器看
bun run test:e2e -- --debug    # 單步

# 釋出前
bun run test:e2e:real          # 燒錢,要先確認 vp-autotest 狀態

# debug
bunx playwright test --ui      # UI mode 互動 debug
bunx playwright show-report    # 看上次 HTML report
```

`playwright.config.ts` 要設:
- `webServer: [vite, bun-server]` 兩個並起,`reuseExistingServer: true`
- `webServer[].env: { VP_TEST_MODE: "mock", HOME: "<tmp-home>" }`
- `use.baseURL: "http://127.0.0.1:5173"`
- `workers: 1` 起步;穩定後 spec file 之間可以 parallel(每 file 自己 tmpdir 不互干)

## 跟 backend / frontend SKILL 的關係

- 改 backend 邏輯 → 看本 SKILL 覆蓋矩陣對應的 spec 是否要更新;**新增 endpoint 要在 mock 模式下也測得到**
- 改 frontend UI → 對應 spec 的 selector/PO 要跟著改;testid 散在元件內,別只改 spec
- 加新 mock 注入點 → 一律走 `/api/__test/*`,不要直接改業務 lib
- 任何讓「real 模式炸但 mock 過」的 PR 都不該 merge — 兩套要互補不互蓋

## 已知 flake / 限制

- 個別 test 在 full suite 跑時偶爾 race,playwright `retries: 1` 擋掉。常見肇因:temp dir cleanup 時 fs.watch noise / mock runner async timeline 殘餘 / vite first-paint。穩定性夠 production 用,但不適合 zero-flake 嚴格要求。
- Mock runner 不做真 git commit(用假 hash 寫 `ticket.commits[]`),所以 merge 的 spec 自己 preBuildBranch 預先寫真 commit。要測「runner 跑完 → merge」端到端,等 phase 4 real 套。
- `/api/__test/*` 控制端點 in-memory 存劇本,server 重啟即清。Test 之間用 `resetMocks()` 顯式清。

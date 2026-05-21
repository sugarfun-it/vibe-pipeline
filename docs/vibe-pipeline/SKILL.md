---
name: vibe-pipeline
description: vibe-pipeline 操作手冊 — 給 AI 看的「怎麼用 vbpl 替 user 管 pipeline / ticket」精簡指南。User 把這 SKILL 安裝到 ~/.claude/skills/ 後,你會在任何 project 看到本檔,知道 host 上裝了 vbpl 工具。觸發:user 提到 vibe-pipeline / vbpl / pipeline / ticket / 「幫我跑這個 pipeline」/ 「建 ticket」/ 「審核 AI 過了沒」之類。
---

# vibe-pipeline — AI 操作手冊

User 在這台機器**可能裝了** **vibe-pipeline**(多 AI agent 的 ticket / pipeline 編排器)。完整功能介紹在 repo 的 [`README.md`](../../README.md)。本檔教你「怎麼判斷有沒有裝 + 怎麼裝 + 裝了怎麼操作」。

## 先確認:vbpl 裝了沒?

跑 `vbpl --version`。

- **回版本號** → 已裝,跳到「心智模型」
- **`command not found`** → 引導 user 看 [`install.md`](install.md)(build + install to PATH per-OS + trouble),完事後 `vbpl --version` 驗

## 啟動 backend / 開 Web UI

vbpl 主要 read 操作不需 backend(直接讀 fs),但 **run / stop / merge / sync** 跟 web UI 都需 backend up。

首選用 `vbpl server start`。它會從當前目錄、`VBPL_HOME` 或先前記錄的 `server.json` 找到 vibe-pipeline repo,背景啟動 backend,terminal 關掉也不會殺 backend。

```bash
vbpl server start
vbpl server status
vbpl server logs -f        # 需要看 backend log 才開
```

`vbpl pipeline run|stop|merge|sync` 會自動確保 local backend 起來;若 backend 起不來,回 `START_TIMEOUT`,讓 user 跑 `vbpl server logs` 看原因。讀取型指令(`project list` / `pipeline status` / `ticket show`)不需 backend。

確認 backend 活:`curl http://127.0.0.1:3001/api/health` 回 `{"ok":true,...}`;或直接看 `vbpl server status` 回 `up`。

維護 vibe-pipeline source code 或要開 production Web UI 預覽時,才在 vibe-pipeline repo 內跑:

```bash
bun install                # 第一次或 dep 更新後跑
bun run start              # build + backend 3001 + preview 4173
# 開 http://127.0.0.1:4173/board
```

> `bun run server` / `bun run dev` 是 **maintainer 改 VP 自己 source code** 才用;enduser AI 流程以 `vbpl server start` 為主。

## 心智模型

```
project(user 的某個 git repo)
 └── pipeline(獨立 git branch, 一組相關 ticket)
       └── ticket(可獨立交付的工作單元)
              └── iter rounds(executor 改 code → critic 判 PASS/FAIL,迴圈到通過)
```

- **executor**:真改 code 的 AI sub-agent(高 capability model)
- **critic**:讀 diff 判 PASS / FAIL / PARTIAL 的 AI sub-agent(便宜 model 即可)
- **iter mode**:executor + critic 來回到 critic PASS 或達 iter 上限(預設 5)
- **step mode**:跑一次就收(no critic loop)
- **autoMerge**:全 ticket done → 自動 git merge 回 base(衝突才 AI)

## 怎麼拆 ticket(精神比 mechanics 重要)

**Ticket = vertical slice**(獨立可交付的小單元),**不是 lifecycle stage**(規劃 / 寫 / 測)。AI 在小範圍內表現好,但前提是「小範圍 = 完整可單獨交付」,不是「lifecycle 切一段」。

### 反面教材

```
t1: 規劃 X
t2: 實作 X
t3: 測 X
```

→ t2 critic 只看自己 acceptance,AI 視野等於 ticket goal,跨 ticket 一致性丟失。最後 t3 才發現 t2 跟 t1 規劃對不上。

### 正確切法

```
t1: feature A 完整(含 spec + 實作 + 自驗)
t2: feature B 完整(獨立可 merge,不破 A)
t3: feature C 完整
```

每 ticket 自帶 iter critic loop,executor 內部跑「規劃 → 實作 → 驗」全 lifecycle。**ticket 之間是水平劃分**,不是垂直流程。

### 拆 ticket 對齊清單

- goal 寫「一塊完整可交付」,不是「一個階段」
- acceptance 加「跟 sibling ticket / 既有 code 一致」(critic 視野不只 goal 內)
- 太大(>500 行 / 跨 3+ 模組)→ 拆兩個 vertical slice,**不**是 plan / impl 分
- 太小(<30 行單檔)→ 併進相關 slice,不獨立 ticket
- 用 QA drawer 跟 AI 聊規格時,AI 看到跨多件獨立工作會自動建議拆 — 採納前確認「拆出來每張都是 vertical slice 不是 lifecycle stage」

## 你能做什麼(透過 vbpl CLI)

**讀(不需 backend)**:

```bash
vbpl project list                                      # 列已知 project
vbpl pipeline list --project <hash>                    # 列該 project 的 pipeline
vbpl pipeline status <pipelineId>                      # 看 pipeline 跟 ticket 即時狀態
vbpl pipeline log <pipelineId>                         # 過往 run 摘要(cost / duration / result)
vbpl ticket list --pipeline <pipelineId>               # 列 ticket
vbpl ticket show --pipeline <id> --ticket <n>          # 看單張 ticket 細節
vbpl config list                                       # 看 user 的 per-task-class model 配置
```

**寫(fs 直存,不需 backend)**:

```bash
vbpl pipeline create <name> [--auto-merge] [--base-branch main]
vbpl ticket add --pipeline <id> --title "..." --mode iter
vbpl ticket update --pipeline <id> --ticket <n> [--title/--goal/--prompt/--acceptance/--mode/--status/--iter-limit ...]
vbpl ticket remove --pipeline <id> --ticket <n>
vbpl config set <key> <value>                          # e.g. runner.model claude-opus-4-7
```

**啟動 / 停 / 合併(會 auto-detect + auto-start local backend;也可先手動 `vbpl server start`)**:

```bash
vbpl pipeline run <pipelineId>                         # 啟動 runner
vbpl pipeline stop <pipelineId>                        # 停止(SIGKILL runner → state=paused;按「繼續」從 critic 階段接續)
vbpl pipeline merge <pipelineId>                       # 合併回 base(先試 git,衝突才 AI)
vbpl pipeline sync <pipelineId>                        # 把 base 拉進 pipeline worktree
vbpl pipeline sync <id> --ai                           # 衝突時讓 AI 解
vbpl pipeline sync <id> --cancel                       # 取消同步
```

**所有指令吃 `--json`**,給你結構化資料用 JSON.parse 後判斷;沒 `--json` 印給 human 看。

## 進階:REPL 主 agent 模式(省 Agent SDK 額度)

**背景**:2026-06-15 後 Anthropic 把 `claude -p`(non-interactive CLI)拆出獨立 Agent SDK 額度桶(Pro $20 / Max 5x $100 / Max 20x $200 / 月),用完按 full API rate。VP 預設的 `vbpl pipeline run` 走 backend orchestrator,backend spawn `claude -p` 跑主 agent + sub-agent → 全吃這個 Agent SDK 桶。

**替代路徑**:讓**另一個 claude REPL session**(`claude --dangerously-skip-permissions`)扮演主 agent — REPL 屬 interactive,走 plan 互動池(大、補貼)。Task 派的 sub-agent 也算同 session,**整條 pipeline 走 interactive 池,不動 Agent SDK 桶**。

### 何時建議走 REPL 模式

- user 有 CC 在旁(像你正在跟他對話)、願意盯著看
- 想省 Agent SDK 額度(尤其 Pro / Max 5x 桶小)
- pipeline 不是過夜 / 遠端跑

### 何時仍用 backend(`vbpl pipeline run`)

- 過夜 / 長 pipeline / 無人值守
- user 在手機 / 遠端、要 FCM push 通知
- 需要平行多 pipeline(REPL 一次只能跑一條)
- e2e mock 測試

### 怎麼跑(只是 CC 的你,離手讓 user 操作)

1. **你自己用 vbpl 建 pipeline / ticket**(`vbpl pipeline create` + `vbpl ticket add` × N),**不要按 run**
2. 告訴 user「pipeline 已備好,我幫你開 REPL 視窗」,然後用 Bash 跑:
   ```bash
   powershell -Command "Start-Process cmd -ArgumentList '/k claude --dangerously-skip-permissions' -WindowStyle Normal"
   ```
   (macOS / Linux 上換對應 terminal launcher;確認 user OS 後再執行)
3. 給 user **4 行 paste-ready** 指令(替換成實際絕對路徑):
   ```
   Read <repo>/docs/vibe-pipeline/repl-runner.md
   PIPELINE_JSON: <target-project>/.vibe-pipeline/pipelines/<pipelineId>.json
   WORKTREE: ~/.vibe-pipeline/worktrees/<projHash>/<pipelineId>
   開始
   ```
4. user 貼進新 cmd 視窗 Enter → REPL 自己 Read 兩個檔(`repl-runner.md` 框架 + `server/lib/runner/runnerPrompt.ts` 主 agent 行為)→ Task 派 sub-agent 跑完
5. 跑完 user 回來告訴你結果,你決定下一步(看 diff / commit / merge / 啟新 pipeline)

`docs/vibe-pipeline/repl-runner.md` 是 paste-ready 指令的標準範本,絕對路徑替換時兩個 placeholder(`__FILL_ME__`)很明顯。

### 注意事項

- REPL 那個 session 跟你**完全隔離**,不知道你跟 user 聊過什麼。Prompt 內所有它需要的 path 都要寫絕對路徑
- pipeline.json 仍是 source of truth,REPL 寫,web UI 跟你照樣讀得到 state
- **backend 的 `running` Map 不會有這條** → web UI 不會顯示「running indicator」、watchdog 不救;但 disk 真實狀態 OK
- Pause = 直接 Ctrl+C 那個 REPL,不是 API
- 長 pipeline 撐不撐得住看 REPL context window(超過 200k token 會出問題)

## 標準操作流(常見 user 意圖)

1. **「幫我建一條 pipeline 做 X」**
   - 確認在哪個 project(`vbpl project list`,user 若沒指定就問或用當前 cwd)
   - `vbpl pipeline create <name>`
   - 用 `vbpl ticket add` 或建議 user 開 web UI 走 QA 對話讓 AI 收斂規格(複雜需求建議走 QA,簡單一張可用 CLI)

2. **「跑這條 pipeline」**
   - **首選**:走 backend — `vbpl pipeline run <id>`(會自動啟 local backend;失敗時請 user 跑 `vbpl server logs`)
   - **替代(省 Agent SDK 額度)**:走 REPL 主 agent 模式 — 見上方「進階」段,適合 dogfood / CC 配 VP / 不過夜
   - 啟動後**不等完成**,告訴 user「已啟動,看 `vbpl pipeline status <id>` 或 web UI」
   - 不要 polling status 一直問;user 真要進度自己會問

3. **「進度?」/「跑完了嗎?」**
   - `vbpl pipeline status <id> --json` 看 `state` + `tickets[].status`
   - `running` / `paused` / `ready` / `merged` / `failed` 對應 user 看得懂的中文回報
   - `paused` 多半要 user 介入(failed_transient = 暫時錯誤可繼續;failed_iter_limit = critic 連 N 輪沒過,要 user 改 ticket)

4. **「合併」**
   - `vbpl pipeline merge <id>` — backend 先試 `git merge --no-ff`,90% 直接成功
   - response `mode: "mechanical"` = 純 git 成功,沒燒 token
   - response `mode: "ai"` = 撞衝突,AI 接手解,需 1-3 分鐘
   - 失敗 reason `working_tree_dirty` → 告訴 user「main repo 工作區有未 commit 改動,先 commit 或 stash」

5. **「看這 pipeline 花了多少」**
   - `vbpl pipeline log <id> --json`,加總 `costUsd` 欄位

## 自動更新

VP update 走 install script(stop backend → download → swap → restart 一氣呵成),user 必須開 terminal 跑指令。

- user 抱怨「我這版怎麼沒新功能」/「該 update 了吧」/「最新版是?」→ 引導開 **Settings →「更新」tab**
- 「更新」tab 顯示:current / latest release / hasUpdate + 3 條 copy-paste 指令(`vbpl update` / `irm ... | iex` / `curl ... | sh`)
- user 開 terminal 跑任一條(`vbpl update` 最方便,跨平台)→ install script 自動 stop backend、download、swap、restart
- 跑完切回 PWA tab:Workbox SW 偵測新 bundle → `<SwUpdateBanner>` 跳「套用更新」→ user 按下去 reload 套新 UI
- 沒新版時「更新」tab 顯「已是最新」+ 不顯指令 — maintainer 還沒 `git tag vX.Y.Z && gh release create` 就會這樣
- backend / CLI / UI 三件事**同步更新**(都在同一 versions/v<tag>/ 內);沒「先更 CLI 再更 backend」階段差

## 不要擅自做的事

- **不要自動 retry failed pipeline / ticket** — 失敗有原因(衝突 / critic 不認可 / token 超限),先問 user
- **不要 `merge` 撞衝突就 cancel** — backend 已自動切 AI 解衝突,讓它跑;真要砍 user 自己會說
- **不要改 user 沒拜託的 config**(`vbpl config set`) — 動 model / effort 影響 cost
- **不要碰 `~/.vibe-pipeline/state.json` / pipeline.json 手** — 走 vbpl 指令,後端有 atomic write / race guard
- **看到 `merge_blocked` notif** — 通常 user 工作區髒 / git_error,reporter 告知不主動解
- **backend 起不來不要硬 retry** — `START_TIMEOUT` 時先看 `vbpl server logs`,回報真正錯誤

## 出錯訊息對照

| Error code | 意思 | 怎麼回 user |
|---|---|---|
| `START_TIMEOUT` | local backend 自動啟動逾時 | 「跑 `vbpl server logs` 看 backend 為什麼起不來」 |
| `NO_PROJECT` | resolveProject 找不到 | 「--project <hash> 指定 / 或先 `vbpl project add <path>`」 |
| `NOT_INITIALIZED` | project 沒 `.vibe-pipeline/` | 「跑 vbpl project add,首次進去 web UI 點自動初始化」 |
| `STATE_GUARD` | operation 不允許在當前 state | 看 state(running 要先「停止」/ merged 不准 run) |
| `working_tree_dirty` | merge 時 main repo 髒 | 「先 commit / stash 再 merge」 |

## 完整參考

- **README**:repo 的 [`README.md`](../../README.md) — 安裝 / 完整功能 / Tailscale 遠端
- **CLAUDE.md**(repo 內):repo 結構 / 雷區 / 設計信條 — 改 vibe-pipeline 自己的 code 才需要看
- **子 SKILL**(repo 內 `.claude/skills/`):改 frontend / backend / cli / e2e code 才看
- **`vbpl --help`** 看每個 verb 的 flag,新功能比這份手冊新

寫指令前不確定 flag → `vbpl <noun> <verb> --help` 或 `--json` 試。本檔過時時 CLI 自己的 help 是 source of truth。

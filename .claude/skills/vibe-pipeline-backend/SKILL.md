---
name: vibe-pipeline-backend
description: vibe-pipeline 後端 / 執行層的職責邊界、約定與 invariants。Phase 1-5 已落地,本 SKILL 是改 server/ 內 code 時要對齊的 canonical reference(不追歷史,歷史在 CHANGELOG.md)。
---

## 開工前

1. 看 root [`CLAUDE.md`](../../../CLAUDE.md) — repo 結構 / 雷區 / 設計信條 / 架構決策
2. 歷次大改動 / 已 final 不做 / Phase 進度 → [`CHANGELOG.md`](../../../docs/CHANGELOG.md)
3. 動非 trivial 改動前回報 scope(預估 N 行 / 影響哪些 routes / 是否動 schema)

## 技術選型(現狀)

- **Bun** 跑 backend(`bun run server`,port 3001,no-watch default)
- 內建用足:`Bun.serve`(HTTP)/ `Bun.spawn`(claude / codex CLI)/ `Bun.file`(fs)
- 不裝 Express / Fastify / Hono / ORM
- Schema 驗證:信任 JSON 結構,`shared/types.ts:isCompleteSpec()` 是少數 runtime 驗證

## 資料夾職責邊界

> 物理路徑樹 → root [`CLAUDE.md`](../../../CLAUDE.md) § Repo 結構。本段只寫**邊界規則**。

- **`server/index.ts`** 只做:啟 `Bun.serve`、解 URL、authGuard middleware、dispatch 到 route。**不寫業務邏輯**
- **`server/routes/*`** 純 dispatch:解 body、call `lib/`、包 response envelope。**不直接 IO**
- **`server/lib/*`** 純 IO + 邏輯,**不知道 HTTP**(可被 `vbpl` CLI 直接 import,不經 server)。每檔一個職責,別跨層
- **`server/lib/qa/*`** QA 子系統 — claude CLI 整合 / draft store / 系統 prompt / parsing
- **`server/lib/cli/*`** Provider 抽象 — claude / codex adapter,給 QA / split / runner 三處用同一介面
- **`server/lib/runner/*`** Pipeline runner — orchestrator / runnerPrompt / runLog / ticketWatcher / syncJob
- **`server/lib/auth/*`** TOTP middleware + storage + cookie + pending setup tokens
- **`server/lib/push/*` + `server/lib/fcm/*`** Web Push token store + firebase-admin fanout
- **`server/lib/spawn.ts`**(2026-05-20 集中)Subprocess 起點唯一統一入口:`runCapture` / `spawnStreaming` / `spawnFireForget` — **default `windowsHide:true`**(別自己 `Bun.spawn` 跳過,Windows 偶發跳 console window);`spawnStreaming` default `detached:true`(POSIX process group,給 killProcessTree 殺整棵用)
- **`server/lib/atomicWrite.ts`**(2026-05-20 集中)`atomicWriteJson` / `atomicWriteText` 內含 Windows EPERM/EBUSY retry + posix chmod + JSON round-trip validation。任何 `~/.vibe-pipeline/*.json` / `pipelines/*.json` 寫入走這個,不要直接 `writeFileSync`
- **`server/lib/jsonl.ts`**(2026-05-20 集中)`readJsonl<T>` / `appendJsonl<T>` 給 audit log + notifs 用,別自己 split `\n`
- **`server/routes/_http.ts`** Response 包裝(`ok` / `err` / `requireJsonUtf8` / `readJson` / `isJsonUtf8`),route handler 統一用
- **`shared/types.ts`** 跨前後端持久化 schema 的 single source of truth(`Pipeline / Ticket / TicketSpec / QAReply / Turn / Draft / NOTIF_EVENTS / TaskClass`)。**不要兩邊各定一份**
- **`~/.vibe-pipeline/state.json`** 只存 global runtime(projects 清單 / last opened)。不存 pipeline / ticket 細節
- **`<target>/.vibe-pipeline/.runtime/`** gitignored 暫存(qa-drafts / notifs.jsonl / logs)

## API 約定

完整 route table 看 `server/index.ts`(Phase 5 後變動快,SKILL 不 snapshot)。主要 namespace:

- `/api/projects/*` — project CRUD / select / open / reveal / git-init / status / branches / runtime / **browse**(client-side folder browser)
- `/api/projects/:hash/pipelines[/:id][/run|/stop|/merge|/sync(|/ai|/cancel|/dismiss)|/worktree/reveal|/runs|/tickets]`
- `/api/projects/:hash/qa/*` — drafts / start / turn / finalize / cancel / split
- `/api/projects/:hash/config`、`/api/user/config` — project + user level
- `/api/auth/*` — TOTP setup / login / sessions / reset
- `/api/push/*` — FCM token register / unregister / config / test

**Response envelope**:統一 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。
常見 error code:`not_found` / `permission_denied` / `dialog_cancelled` / `invalid_path` / `not_initialized` / `already_initialized` / `state_guard` / `working_tree_dirty` / `internal_error`。

**Metadata endpoint 別塞 git**(2026-05-20 踩過):列表 / status / config 等高頻 endpoint,handler 走純 fs 拿 metadata 就好,**不要順手呼 git**(`currentBranch` / `workingTreeStatus` 等)。每個 endpoint「順便」一次 git 看似無害,但 page mount 觸發 N 個 endpoint 同時打 git,Windows 上 git.exe 每次 fork 多個 helper,瞬間炸幾十個視窗(無 windowsHide 場景)+ backend 卡 ~500ms。git 結果該獨立 endpoint(lazy fetch when UI needs it),或 backend cache TTL。`projectStore.toProject` 已示範:純 fs,**不**呼 currentBranch。

**Project hash**:`sha256(absolute_path).slice(0, 8)`。Pipeline id:`<12-hex-ms-ts>-<slug>`(本機時間序,但**排序靠 `Pipeline.createdAt` 不靠 id**,id 可能是 fixture 假造)。

## 子系統設計重點

### QA(`server/lib/qa/`)

- 第一輪:`claude/codex -p --session-id <uuid> --system-prompt QA_BEHAVIOR_PROMPT --disallowedTools "Edit Write Task" "<msg>"`
- 後續輪:`--resume <sessionId> --append-system-prompt "<reminder>"`
- session-id 由我們生(`crypto.randomUUID()`),非 CLI 給
- 工具策略:**只擋 Edit / Write / Task**(改檔 + sub-agent),其他開放讓 AI 查專案
- **Reply parsing 4 層 fallback**:fenced json → 直接 object → 抽第一個 `{}` → 包成 `{message, options:[], complete:false, spec:null}` 不崩
- **Contract enforcement**:AI 宣告 `complete=true` 但 5 欄 spec 缺一 → 強制改回 `false`,user 不會看到空白 SpecReview
- **確認輪契約**:5/5 收齊不立刻 complete,加一輪三選一(`建立 ticket` / `我要再調整` / `從頭重來`)字面值嚴格
- **Reopen 規則**:前輪 AI 自回 complete=true + user 又送訊息(非「建立 ticket」字面)→ complete 必須改回 false 當需求補充
- `draftStore.appendTurn` auto-complete 只在 `!wasComplete && reply.complete !== false && 5/5` 才 fire — 尊重 AI 在 reopen 時的 false

### Runner(`server/lib/runner/`)

- 主 agent 支援 claude 與 codex(provider 鏈一致化:主 = X → sub 也用 X)
- **`--dangerously-skip-permissions` 永遠帶** — 跨 provider sub-agent 必要(codex sub-agent 內部 Bash 在 auto 模式會被擋)
- 主 agent 工具白名單:Edit/Write 改 pipeline.json + worktree 外 tmp(commit message)+ Bash read-only + git add/commit;**source code 改動 100% 透過 sub-agent 派發**
- Sub-agent 拆兩個 TaskClass:`executor`(改 code,高 capability)+ `critic`(讀 diff 判 PASS/FAIL,可便宜 model)
- ticket commit 用 `git commit -F <tmpfile>` 多段 message,不用 `-m "...\n..."` 字面 \n
- provider-aware dispatch:claude → Task tool;codex → 主 agent 用 `spawn_agent` → `wait_agent` → `close_agent` 三步 atomic in-process 序列(取代舊 Bash `codex exec` subprocess);`codexAdapter.spawnRunner` 自動加 `-c features.multi_agent=true`;工具限制走 sandbox 模式分流(executor / merge = `workspace-write`,critic = `read-only`)
- **Stop = SIGKILL immediate**:user 按「停止」→ orchestrator SIGKILL child + 標 `state=paused`。**沒有 graceful 路徑、沒有 `stopping` 中介 state**(2026-05-17 簡化,見 root CLAUDE.md §Pause 路徑簡化)
- **`killProcessTree(pid)` 跨平台**(2026-05-21):Windows `taskkill /T /F /PID <pid>`;POSIX `process.kill(-pid, "SIGKILL")` 殺整 process group(需 `spawnStreaming` default `detached:true` 建 group)+ fallback 殺單 pid。背景:Stop 只殺主 agent → orphan claude / codex children 留下吃 token
- `recoverStale` server boot 掃 stale `running` → paused;同時修 legacy `stopping` 殘留(舊 schema 升級無痛);watchdog 抓死 PID

### Merge / Sync 二段式(`pipelineMerge.ts` + `syncJob.ts`)

兩者對稱:**git-first → 衝突才 AI**。

- `autoMergeNoAI()`:`git checkout base + git merge --no-ff`,clean → state=merged + emit `pipeline_merged`;conflict → `merge --abort` + reason="conflict";dirty/git_error → 對應 reason
- `mergePipeline` route(manual)和 `orchestrator.maybeAutoMerge`(auto)看 reason 分流:conflict → 升級 `triggerMerge`(spawn AI);dirty/git_error → emit `merge_blocked`
- **autoMerge 升級時 emit `pipeline_auto_merge_started` + FCM push**「🤖 AI 接手解衝突」(autoMerge 場景 user 不在現場)
- response 加 `mode: "mechanical" | "ai"` discriminator;CLI / Web UI 依此分流訊息
- `alreadyMerged`(ahead=0)路徑也自動清:state=merged + 殘存 failed merge ticket 改 done + 清 lastAutoMergeError
- **Sync 成功判定靠 git 三條件**(不靠 AI stdout):`!MERGE_HEAD && !conflictMarkers && behindBaseCount===0`。理由見 root CLAUDE.md §AI sync 成功判定靠 git
- `syncJob.recoverStaleSync()`:server boot 收 `state ∈ {merging, ai_running}` 殘骸 → `merge --abort` + 標 failed
- **`ensureDepsAfterMerge`**(`server/lib/depInstall.ts`):mechanical / AI merge path 結束都 diff `mergeCommit^1..mergeCommit` 的 `package.json` deps keys + `bun.lock`,變動就同步跑 `bun install`;失敗 emit `pipeline_merge_cleanup_failed` notif 不阻斷 merge 成功。背景:self-dogfood pipeline 加新 dep 後 main repo node_modules 不會自動同步(雷區 #12)
- 完整設計 → [`docs/refs/archive/sync-redesign-2026-05-13.md`](../../../docs/refs/archive/sync-redesign-2026-05-13.md)

### Pipeline delete cascade(`routes/projects.ts:deletePipeline`)

`DELETE /api/projects/:hash/pipelines/:id` 一條清完:worktree dir(`worktree.removeQuiet` + git worktree prune)+ git branch `-D pipeline/<name>` + `pipelines/<id>.json` + emit `pipeline_deleted` notif。**running / queued state 拒絕**(回 `STATE_GUARD`「先 stop」),paused / ready / merged / failed 都可砍。中間任一步失敗回 partial result(report 哪步失敗 + 哪些清掉),user 看 message 手動補。

### Audit log via(`server/lib/auditLog.ts`)

`user_action` entry 加 `via?: "cli" | "browser" | "other"` 欄。`routes/projects.ts:detectVia(req)` 讀 `User-Agent` header → "vbpl-cli" 命中 cli;"Mozilla" 命中 browser;其他歸 other。debug「mystery run」(audit 抓到 user 沒按)時可秒判 source。`withUserAudit` 從 router 收 req 傳入,handler 加 `via: detectVia(req)` 到 meta。新加 mutation handler 想標 via 也是同模式。

### Auth(`server/lib/auth/`)

- `authGuard()`:loopback IP(`127.0.0.1` / `::1`)永遠 bypass + setup/login/status path bypass + cookie validate → redirect `/setup` or `/login`
- `vp_auth` cookie:HttpOnly + SameSite=Strict + 7d
- TOTP secret 寫 `~/.vibe-pipeline/auth.json`(`fs.chmod(0o600)` Windows NTFS 不生效,見 [`.claude/rules/remote-access.md`](../../../.claude/rules/remote-access.md))
- setup_token 是 in-memory map,5min 過期 — server restart 期間中斷的 setup 必須重來

### Push(`server/lib/push/` + `server/lib/fcm/`)

**2026-05-19 後架構**:VP backend 拔 `firebase-admin`,push 走 maintainer host 的 gateway(Cloud Run asia-east1 `https://vp-gateway-...run.app`)。service account key 集中在 gateway 端;同日 lazy auto-issue 落地後,enduser 端 token 由 backend 在 register 觸發點自動跟 gateway 申請,無需任何手動設定。

- **`gatewayToken.ts`** lazy module(SSOT `~/.vibe-pipeline/gateway-token`):`getToken()` 被動讀(沒檔回 null) / `ensureToken()` 沒檔則 POST `gateway/tokens/auto-issue`(無 auth,gateway 端 IP rate-limit 5/UTC day)拿 + 寫檔 / `clearToken()` 砍檔。寫入 atomic `.tmp → rename` + posix `chmod 0600`(Windows NTFS chmod 不生效照雷區 §Windows ACL);in-flight Promise 合併並發 register 避免雙申請。`PUSH_GATEWAY_TOKEN` env 是 read-only override(forker / CI),env 設了就跳過檔案
- `DEFAULT_GATEWAY_URL = https://vp-gateway-799841449136.asia-east1.run.app` 在 `fcm/index.ts` **跟 `push/gatewayToken.ts` 兩處都 hardcode**(對齊,2026-05-21 補)。`PUSH_GATEWAY_URL` env 可 override。enduser `.env` 完全不必設 push 相關 var。改 url 兩處同步,別只改一邊 → `ensureToken` issue 不到 token
- `tokenStore`:`register` / `unregister` 進入點呼 `ensureToken` 確保 token 存在 → 轉發到 gateway `POST /push/register` / `DELETE /push/token`;`listTokens` 用被動 `getToken`(避免誤觸 auto-issue rate limit)。本地不存 device tokens(舊 `~/.vibe-pipeline/device_tokens.json` 已不寫)
- `fcm/index.ts`:`fanoutPush(payload)` = `fetch(gatewayUrl + '/push/send', { Authorization: 'Bearer ' + getToken(), body: payload })`;沒 token → warn + return [](不 throw),死 token 由 gateway 端 Firestore registry 偵測 + 清
- 改 push code 不要假設 gateway 一定回 200;加 error log 但別 throw,push 是 best-effort
- `ticketWatcher.ts`:fs.watch pipeline.json + diff status → emit ticket_* notif + 呼叫 `fanoutPush`(行為不變,只是底下換 HTTP)
- 前景 / 背景 push 行為差異雷見 [`.claude/rules/pwa-sw.md`](../../../.claude/rules/pwa-sw.md) §Android push 行為
- gateway service code 在 repo 內 `gateway/`(Bun + Firestore,~500 行,multi-tenant per-token registry,含 `/tokens/auto-issue` 無 auth 端點 + `/tokens/*` admin 端點);admin CLI `vp-gw-admin` 發 token / revoke / list
- 設計 spec → [`docs/refs/archive/fcm-push-gateway-2026-05-17.md`](../../../docs/refs/archive/fcm-push-gateway-2026-05-17.md);maintainer ops note:Cloud Run max-instances=1 + $1/mo budget alert hard cap abuse,auto-issue IP rate-limit 5/day 防 token farm

### Self-update(`server/lib/updater.ts` + `systemVersion.ts`)

**2026-05-21 tarball + launcher-script pattern**(2 次改寫):enduser 安裝在 `~/.vibe-pipeline/app/` 沒 `.git/`,git pull 用不到。第一版直接在 backend process 內 `rmrf(app/)` + spawn,但 Windows 上 backend cwd 就是 `app/`,EBUSY 然後 rename EPERM,**`app/` 內容被刪光留空殼變 zombie**。改成 launcher pattern。

- `systemVersion.ts`:`getVersionStatus()` 讀當前 commit / branch + `fetchLatestRelease()` 打 GitHub `releases/latest`(unauthenticated,有 cache 避 rate limit)
- `updater.ts`:
  - `preflightCheck()`:兩條(`globalRunningCount()===0` + `hasUpdate`),git clean 已拔
  - `downloadAndStage()`:GitHub releases/latest 取 .tar.gz / .zip asset(優先)→ fallback `tarball_url`(needsStripTopLevel=true)→ 下載 `~/.vibe-pipeline/app.download.tmp/` → 解壓 `~/.vibe-pipeline/app.staging/` → resolveRoot → 回 `{ tag, stagingRoot, cleanupPaths }`。**不動 `app/`**
  - `writeHelperScript({backendPid, stagingRoot, cleanupPaths})`:寫平台 helper 到 `~/.vibe-pipeline/update-helper.{ps1,sh}`(Win 強制 ASCII-only 避 5.1 ANSI 讀檔 mis-parse,POSIX `chmod 0755`)。Helper 邏輯:wait backend pid exit(max 30s,逾時 force kill)→ rmrf app/(retry 20× 應付 Windows fs 釋放延遲)→ rename stagingRoot → app/ → cleanup tmp → spawn 新 backend(stdout/stderr → `~/.vibe-pipeline/server.log` 對齊 `vbpl server start`)→ self-delete
  - `spawnHelperDetached(helperPath)`:Windows `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`;POSIX `bash`。Detached + `windowsHide` + ignore stdio
  - update flow:route `system.ts:update` 跑 preflight → emit `system_updating` notif → `downloadAndStage` → `writeHelperScript` → `spawnHelperDetached` → response 200 → **setTimeout 1500ms** `process.exit(0)`(讓 helper 起來開始 watch backend pid + client 拿 response)
  - log 全程 `~/.vibe-pipeline/update.log`(truncate per run;helper 也 append 同檔)
- **bun path 走 `process.execPath` 寫進 helper**:helper 不依賴 PATH 找 bun,直接用 backend 自己的 bun 路徑
- **dev clone 永遠不被碰** — 在 dev repo 按 Settings「更新」也只動 `~/.vibe-pipeline/app/`;要驗 enduser update flow 另開 enduser-style 安裝
- `scripts/build-tarball.ts`(maintainer 端)走嚴格白名單組 tarball,whitelist 清單見 README §Maintainer 發 release;新 server 子目錄要進 tarball **必須改本檔白名單**,否則 enduser 收到的 tarball 缺檔
- 設計 ref → [`docs/refs/enduser-install-update-design.md`](../../../docs/refs/enduser-install-update-design.md)

### CLI adapter(`server/lib/cli/`)

- `CliAdapter` 介面 + `QASpawnOpts` / `RunnerSpawnOpts`(`needsBypassPermissions`)/ `SplitSpawnOpts`
- `claudeAdapter`:perf flags + 跨 provider 加 `--dangerously-skip-permissions`
- `codexAdapter`:`-c model="..."` config override / `-s read-only|workspace-write` sandbox / JSONL parse
- `getAdapter(taskClass, provider)` factory
- 加新 provider → 實作 `CliAdapter`,接 `getAdapter` switch,prompt 維持 provider-agnostic
- **prompt 永遠走 stdin,不走 positional arg**(Ruflo issue #1852):Windows cmd.exe 對長 prompt /
  含引號 / 控制字元的 positional arg 會 re-tokenize 把參數錯位。claude / codex 兩邊 adapter 全 spawn
  點都 `stdin: "pipe"` + `sink.write(prompt); sink.end()`,args 不夾 prompt 字串。codex 已 native 用
  stdin(args 最後一個 "-");claude `-p` / `--resume` / `--system-prompt` 都允許 stdin 接管。
- **claude spawn env 必清 nested-session 變數**(Ruflo issue #1395):claude CLI 看到
  `CLAUDE_SESSION_ID` / `CLAUDE_PARENT_SESSION_ID` 會誤判為 nested Claude Code session 直接拒跑。
  adapter 內 `workerEnv()` helper:`...process.env` → 設 `CLAUDE_ENTRYPOINT=worker` + delete 那兩個 var。
  claudeAdapter 3 處 spawn 全套;codexAdapter 也同步套(codex 不認那些 env 但設了無害,統一 spawn
  環境減心智負擔)。改 adapter 新 spawn 點要記得帶 `env: workerEnv()`。

### User config(`server/lib/userConfig.ts`)

- `~/.vibe-pipeline/config.json` per-task-class:`qa / split / runner / executor / critic / merge` → `{ provider, model, effort }`
- `coerceConfig` migration:舊 `subAgent` key → `executor`,critic 走 default
- `getTaskConfig(tc)` 給 spawn 點用;`patchUserConfig()` PUT 白名單 + 三欄獨立驗

### Pipeline dir(`server/lib/pipelineDir.ts`)

- `init()` idempotent — partial init 殘骸補齊不報錯
- `.gitignore` 自動補 `.vibe-pipeline/.runtime/` + `.vibe-pipeline/pipelines/`
- `listPipelines` 用 `Pipeline.createdAt` 排序,無欄位 backfill 用 id-ts
- 寫入路徑 normalize 防 `..` 跳出 project root(safety invariant)

## 安全 invariants

- `POST /init` assert path 合理(防 `/` / `~` 當 project root)
- json 寫入 atomic(tmp + rename),避免 crash 中斷後檔案半段
- fs 操作 normalize 路徑,防 path traversal
- `ALLOWED_ORIGINS` CORS 白名單不放 `*`(雷見 root CLAUDE.md 手機遠端段)
- **pipelines/*.json mutation 一律走 backend(vbpl / API)**,**禁止任何外部 caller(包括對話 AI / Python 腳本 / Edit / Write / mv)直接 fs write**。理由:race guard / savePipeline validation / running 中 ticket 鎖 / main agent dispatch 全在 backend 內;直接 fs 繞過所有保護,造成 state corruption(已踩:reset/swap/race guard bypass 多次)。例外:**只有 backend 本身重啟 recovery 程式碼**可在 backend 內走 `pipelineDir.writePipeline` 直接寫
  - 對 AI:跑中 pipeline → 一律 `vbpl pipeline stop` + `vbpl ticket update/add/remove` + `vbpl pipeline run`,不准 Python / Edit / mv 直接 patch `.vibe-pipeline/pipelines/*.json`
  - paused pipeline 改動雖無 race risk,**仍走 vbpl** 維持單一 mutation 通道(future MCP scope / audit log 才能 cover)

## 待動工(動到走 ScopeReport)

清單在 [`docs/TODO.md`](../../../docs/TODO.md)(對應 phase 8 pipeline)。backend 相關現存:#3 secret 洩漏偵測 / #5 backend self-heal / #7 worktree staleness / #10 recoverStale 太武斷 / #11 ticketWatcher reconcile 設計化(原 #1 FCM gateway 已落地)。

## 觸發本 SKILL 的場景

- 改 `server/` 內任何檔(routes / lib / runner / qa / auth / push / fcm / cli adapter)
- 加新 endpoint / 動 response envelope / 改 error code
- 處理 pipeline state machine / merge / sync 邏輯
- 跟 claude / codex CLI spawn 相關
- 動 `~/.vibe-pipeline/` 內任何 json

不確定算前端還後端 → 看碰的檔在 `src/` 還 `server/`,各歸各 SKILL。

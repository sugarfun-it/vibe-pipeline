---
name: vibe-pipeline-cli
description: vbpl CLI — vibe-pipeline 本地命令列操作介面(改 / 加 / 看 project / pipeline / ticket / config),不開瀏覽器就能管 pipeline。改 cli/ 內任何檔前先讀本 SKILL。
---

# vibe-pipeline-cli

`vbpl` 是 vibe-pipeline 的本地 CLI,等同瀏覽器 UI 的 cmdline 版,給 user 不開 browser 也能管 project / pipeline / ticket / config。**核心設計**:reuse `server/lib/*` modules 直接讀寫 fs,**不走 HTTP**(沒 backend 起也能用)。

## 物理結構(摘要,完整在 root [CLAUDE.md](../../../CLAUDE.md) § Repo 內)

```
cli/
├── vbpl.ts             entry point — parseArgs + dispatch noun → commands/*
├── commands/
│   ├── project.ts      list / show / add / remove
│   ├── pipeline.ts     list / create / show / delete / run / stop / status / log
│   ├── ticket.ts       list / show / add / update / remove
│   ├── config.ts       list / get / set(user-level config.json)
│   └── server.ts       start / stop / status / restart / logs(背景管 backend daemon)
└── lib/
    ├── args.ts         極簡 flag / positional 解析,不依賴 commander 等套件
    ├── output.ts       ok / fail / print / table 統一輸出(human + --json 兩模式切)
    ├── project.ts      resolveProject(--project hash / --project-path / state.json lastProject 三層 fallback)
    ├── api.ts          HTTP POST wrapper(requireBackend + post + User-Agent: vbpl-cli)
    ├── ensureBackend.ts try-connect-first + lock 自動 spawn backend(避免兩 CLI race)
    ├── serverBase.ts   apiBase()(VBPL_API_BASE env 或 default 127.0.0.1:3001)
    └── serverPath.ts   auto-detect VP repo:cwd git root → VBPL_HOME → ~/.vibe-pipeline/server.json
```

`package.json` 對應 `bun run vbpl` → `bun run cli/vbpl.ts`。打包 binary 後 `vbpl` 直接在 `~/.vibe-pipeline/bin/`(install.md 指定統一位置,對齊 pyenv / cargo / nvm 慣例)。

## 設計信條

### 1. Read 直 fs,mutate spawn / kill 走 HTTP

**Read 操作**(list / show / status / log / config get):直接 `import * as pipelineDir from "../../server/lib/pipelineDir"` 然後 `pipelineDir.readPipeline(path, id)`。理由:
- backend server 沒起也能用 CLI(state.json / pipeline.json 都在 fs)
- 沒網路 round-trip,本地操作毫秒級
- 共享同套驗證 / 寫盤邏輯,行為一致

**Mutate 純 fs 操作**(project add / remove / pipeline create / delete / ticket add/update/remove / config set):也直存 fs(沒 spawn child process,純寫 json)。

**Spawn / kill 子程操作**(`vbpl pipeline run / stop / merge / sync --ai / sync --cancel`):**必須走 HTTP POST 給 backend**。透過 `cli/lib/api.ts:post()` 包好的 `requireBackend()` → `ensureBackend()` → fetch。

為什麼:CLI 自己 spawn child 會在 CLI process 退出時失去 child 控制權(orchestrator running map 蒸發,watchdog / pause / stop 全失效,實測 Windows 上 child 也常被當孤兒 GC)。改成 backend 養 child:CLI 死了 backend 還活著,child 仍可被監控、kill、cleanup。

- 環境變數 `VBPL_API_BASE` 覆寫 default `http://127.0.0.1:3001`
- backend 沒起 → `ensureBackend` **自動 try-connect-first + lock + spawn**(2s timeout),user 看不到 NO_BACKEND error。失敗才回 friendly error 提示 `vbpl server logs`
- 多 CLI 並發 race-safe(`~/.vibe-pipeline/server.start.lock` flock,只一個贏家 spawn,其他等 health 通)
- POST fetch 自帶 `User-Agent: vbpl-cli`,backend audit 寫入 `via: "cli"` 區分 vs browser(debug mystery run 用)

代價:CLI 跟 backend lib 強耦合,改 `server/lib/*` 的 export 介面要記得 CLI 也用;新增 mutate verb 要決定走 fs 還是 HTTP(原則:有沒有 spawn 或 kill child process)。**改 server/lib 前 grep `from "../../server/lib"` 確認 CLI 是否吃到**。

### 2. --json mode 為機器可讀,human mode 為 user 友善

每個 command 都吃 `--json`(可放任意位置):
- human mode:print 表格 / 條列 / 自然語句
- json mode:**只**輸出 `{"ok": true, "data": ...}` 或 `{"ok": false, "error": {"code", "message"}}` 單一 JSON object(stdout 結尾 `\n`),其他 print 一律 no-op

所有輸出走 `lib/output.ts` 三入口:
- `ok(data)` — JSON mode 才印(human mode 由 caller 自己 print)
- `okJson(data)` — 強制 JSON 輸出(list 等場景兩 mode 都需要)
- `fail(code, message, exitCode=1)` — never return,直接 process.exit。JSON mode 印 stderr-friendly JSON 到 stdout,human mode 印紅字到 stderr

不要在 command 內手刻 `console.log` / `console.error`,**全走 output 模組**。

### 3. Error code 對齊 backend 慣例

`fail()` 第一個參數是大寫 SCREAMING_SNAKE code:
- `INVALID_ARGS` — 參數不齊 / 格式錯
- `NO_PROJECT` — resolveProject 找不到
- `NO_BACKEND` — `requireBackend()` health check 失敗(spawn / kill verb 需 backend up)
- `NOT_INITIALIZED` — `.vibe-pipeline/` 不存在
- `NOT_FOUND` — pipeline / ticket id 不存在
- `STATE_GUARD` — operation 不允許在當前 state(e.g. pipeline 已 merged 不准 run)
- `IO_ERROR` — fs / spawn / fetch 失敗 fallback

新加 command 用既有 code,不夠才加新的(也在這 SKILL 補一行)。

### 4. Project resolution 三層 fallback

`resolveProject(flags)` 解析:
1. `--project-path <abs>` → 用該 path 算 hash
2. `--project <hash>` → projectStore.findByHash(hash)
3. 都沒 → `projectStore.getLastProject()`(state.json 內 lastProject)

三層都解不到才 `fail("NO_PROJECT", ...)`。新 command 一律呼這個,**不要自己再寫 project 解析**。

## Noun × verb 矩陣

| noun | verbs(粗體 = 走 HTTP,其餘 fs) |
|---|---|
| `project` | list / show / add `<path>` / remove `<hash>` |
| `pipeline` | list / create / show / **delete** / **run** / **stop** / **merge** / **sync** / **sync --ai** / **sync --cancel** / sync --dismiss / status / log |
| `ticket` | list / show `<id>` / add / update / remove,**全部要 `--pipeline <id>`**;`add` 額外必填 `--title --goal --prompt --acceptance`(沒帶 → INVALID_ARGS) |
| `config` | list / get `<key>` / set `<key> <value>`(user-level `~/.vibe-pipeline/config.json`) |
| `server` | **start** / **stop** / **status** / **restart** / **logs [-f]**(全 fs + spawn,管 backend daemon 自己,不走 HTTP) |

走 HTTP 的 verb 需要 backend up — `ensureBackend` 自動 spawn(若有 `server.json` 記得到 repo),不必先手動 `vbpl server start`。極端情況才會回 `NO_BACKEND`。

`pipeline log` 走 `runLog.listRuns` + `getRun`(同 RunHistory drawer 後端,fs)。
`pipeline run` 走 `POST /api/.../run` → backend 內 `orchestrator.start(...)` spawn child → backend 養 child 不會孤兒。
`pipeline merge` 走 `POST /api/.../merge` → backend 二段式(autoMergeNoAI → conflict 才 AI),response `mode: "mechanical" | "ai"` 分流訊息(mechanical 直印 commit hash;ai 印 ticketId + 提示 watch log)。
`pipeline create` 沒帶 `--auto-merge` flag 時 fallback 讀 project config `defaults.auto_merge`(對齊 web UI)。
`pipeline delete` cascade 清 worktree + branch + pipeline.json(running / queued state 拒絕,要先 stop),`--force` 跳 confirm。
`server start` auto-detect VP repo(cwd → VBPL_HOME → ~/.vibe-pipeline/server.json),背景 spawn `bun run server`,detach 後 terminal 不阻塞。**enduser 永遠不必手動 cd 進 VP repo**。`server logs -f` tail server.log。

## 不踩的雷

1. **不在 CLI 起 server / 監聽 port** — CLI 是 one-shot 工具,跑完 process exit。要長跑(watch)走 web UI / 別的工具
2. **不直接動 `~/.vibe-pipeline/state.json`** — 透過 `projectStore.open(path)` / `projectStore.remove(hash)`,讓 backend 維持 atomic write 慣例
3. **改完 `.vibe-pipeline/pipelines/*.json` 不通知 frontend** — CLI 是 sidechannel;若 user 同時開 web,frontend 5s polling 才會看到。建議 CLI 文案用 `Tip: refresh web UI to see changes` 之類提示
4. **`--json` mode 嚴禁 print 任何非 JSON 字串到 stdout** — 否則 caller `JSON.parse(stdout)` 會炸。Debug 要走 stderr 或丟 env `DEBUG=1`
5. **跨平台 path** — 用 `node:path` 的 `resolve` / `join`,不要拼 `\\` 或 `/`;Windows / POSIX 都吃
6. **`pipeline run` 不等 runner 完成** — orchestrator.start spawn 後立刻返回,CLI 跟著 exit;真實狀態看 `pipeline status` / `pipeline log`。**不要加 `await proc.exited`**,會卡住 user terminal 半小時
7. **對話 AI 改 pipeline state 一律走 vbpl,禁止直接寫 `.vibe-pipeline/pipelines/*.json`** — race guard / savePipeline validation / main agent dispatch 全在 backend,Python / Edit / mv 直接 patch 會 bypass 全部保護造成 state corruption。**詳規則見** [`vibe-pipeline-backend/SKILL.md`](../vibe-pipeline-backend/SKILL.md) §安全 invariants

## 加新 command 的 checklist

1. 在對應 `commands/<noun>.ts` 的 switch 加 case
2. 該 case 函式:
   - 第一行 `const proj = await resolveProject(args.flags)`
   - 若操作 pipeline 內容 → `await requireInit(proj.path)`
   - 參數驗證 → `fail("INVALID_ARGS", ...)`
   - 業務邏輯 → 呼 `server/lib/*` 既有函式
   - 輸出 → `if (isJsonMode()) okJson(data); else printLines([table(rows)])`
3. 更新 `vbpl.ts` 的 USAGE 字串
4. 若新 noun → 在 vbpl.ts switch 加分支 + 開新 `commands/<noun>.ts`
5. 不寫單元測試(CLI 本身是 thin wrapper,coverage 在 backend lib);**改 lib 才寫 backend test**

## 開工前

- 改 `server/lib/projectStore` / `pipelineDir` / `runner/orchestrator` 等 → CLI 同樣會吃到,grep `from "../../server/lib"` 看影響面
- 預期 `--json` 行為 → 跑 `bun run vbpl <noun> <verb> --json | jq .` 驗
- 跨平台:Windows / macOS / Linux 都該過,path / spawn 都要小心(`node:path` + Bun.spawn array form)

## 散發給 enduser

不打包 binary。Enduser 走 install script(`scripts/install.{ps1,sh}`),寫個 99-byte shim `~/.vibe-pipeline/bin/vbpl[.cmd]` 內含:

```cmd
@echo off
set VBPL_HOME=%USERPROFILE%\.vibe-pipeline\current
bun run "%VBPL_HOME%\cli\vbpl.ts" %*
```

(POSIX `vbpl` 對等 `bun run`。)

Shim 跨版本穩定不被 update 動;`current` junction 指當前 `versions/v0.X.Y/`,update 換 junction → 下次 invoke `vbpl` 自動跑新 source。完整 install + update 流程看 [`docs/vibe-pipeline/install.md`](../../../docs/vibe-pipeline/install.md)。

歷史上有 `bun build --compile` 出 `vbpl.exe`(~121 MB),v0.2 拔了 — shim 模型更簡單、無 stale binary 問題、self-update 走 install script 就同步整個 cli + server source。

## 還沒做

- TUI / interactive mode(`vbpl repl` 之類)— 看 user 反應再加
- shell completion(bash / zsh / pwsh)— 同上,有需求再做
- `vbpl pipeline log <id> --follow` — pipeline run log tail(現在是 one-shot dump);`vbpl server logs -f` 已 ship 是 server.log 不同檔
- CI release(`gh release` 自動 build + upload artifact),目前 user 自己 build 自己用

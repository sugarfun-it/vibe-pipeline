# server/lib 分層重構 — design

**Status**: draft → ready for implementation plan
**Owner**: maintainer
**Scope**: 純結構重構,**零行為變動**(API / 路由 / 資料格式 / 測試 oracle 都不動)

## 動機

`server/lib/` 目前 25 個 top-level 條目 + 7 個子目錄,扁平堆疊。實際痛點:

1. **職責邊界模糊**。`pipelineDir.ts` 390 行同時管:project 級 `.vibe-pipeline/` init / gitignore / worktree-include 模板 / per-target config 讀寫 / pipeline CRUD / synthetic merge ticket — 5 個職責一檔,改 config schema 跟改 pipeline 寫入彼此擾動。
2. **撞名**。`server/lib/spawn.ts`(child spawn 包裝)跟 `server/lib/runner/orchestrator/spawn.ts`(起 main agent)同名,grep / IDE 開錯檔。
3. **同概念散兩處**。`server/lib/git.ts`(top-level)跟 `server/lib/git/worktree.ts`(子目錄)放兩層,新加 git helper 沒準則該擺哪。
4. **目錄存在意義不一致**。`notifs/store.ts` 只一檔卻有 `notifs/` 目錄;`fcm/index.ts` 同。沒新檔可加時是噪音。
5. **沒分層**。`pipelineMerge.ts`(import runner + domain + io)跟 `auditLog.ts`(純 domain)平行擺,讀的人看不出依賴方向。

## 目標 / 非目標

**目標**:
- 把 `server/lib/` 切成五層(io / domain / remote / system / services),每層依賴方向單向(io < domain < remote / system < services / runner / qa / cli)
- 拆 `pipelineDir.ts` 5 職責為 4 個獨立檔
- 消除撞名(`spawn.ts` → `childSpawn.ts`)、合併同概念(`git.ts` 併入 `io/git/`)、拍平單檔目錄(`notifs/store.ts` → `remote/notifs.ts`、`fcm/index.ts` → `remote/fcm.ts`)
- 統一 domain 概念命名(`projectStore` → `project`,跟 `pipeline` / `userConfig` / `auditLog` 對稱)

**非目標**:
- 不改任何函式 signature / 行為 / API 路由
- 不改 routes 內任何 handler 邏輯
- 不改測試 oracle(只改 e2e / unit test 內 import path)
- 不重寫 `pipelineDir.ts` 內任何邏輯(只搬位置 + 必要的 const 歸屬)
- 不動 `runner/` / `qa/` / `cli/` 內部結構(已分子目錄,結構健康)
- 不解決 TODO #2(Runner state 三源同步,architectural,獨立 spec)
- 不解決 TODO #6(前端 primitive 邊界,獨立 spec,串行下一條)

## 新目錄結構

```
server/lib/
├── io/                       # 純 platform primitive,零 domain 知識
│   ├── atomicWrite.ts
│   ├── jsonl.ts
│   ├── fs.ts
│   ├── hash.ts
│   ├── paths.ts
│   ├── dialog.ts
│   ├── childSpawn.ts         # 原 spawn.ts(rename)
│   └── git/
│       ├── index.ts          # 原 git.ts(hasGit / gitInit / currentBranch)
│       └── worktree.ts       # 原 git/worktree.ts(move only)
├── domain/                   # repo / project / pipeline / config 概念
│   ├── project.ts            # 原 projectStore.ts(rename)
│   ├── userConfig.ts         # 原 userConfig.ts(move)
│   ├── auditLog.ts           # 原 auditLog.ts(move)
│   ├── projectDir.ts         # 原 pipelineDir.ts 抽:.vibe-pipeline/ init + gitignore + worktreeinclude
│   ├── projectConfig.ts      # 原 pipelineDir.ts 抽:per-target config 讀寫 + clamp + getResolvedDefaults + DEFAULT_*
│   ├── pipeline.ts           # 原 pipelineDir.ts 抽:pipeline CRUD + mutate + generatePipelineId
│   └── mergeTicket.ts        # 原 pipelineDir.ts 抽:appendMergeTicket
├── remote/                   # push 鏈(本地 emit → gateway → FCM)
│   ├── notifs.ts             # 原 notifs/store.ts(拍平)
│   ├── fcm.ts                # 原 fcm/index.ts(拍平)
│   └── push/                 # 子目錄保留(內部兩檔職責不同)
│       ├── gatewayToken.ts
│       └── tokenStore.ts
├── system/                   # VP 自己的元件(版本 / 更新 / merge 後 deps housekeeping)
│   ├── version.ts            # 原 systemVersion.ts(rename + move)
│   ├── update.ts             # 原 updater.ts(rename + move)
│   └── depInstall.ts         # 原 depInstall.ts(move)
├── services/                 # cross-domain 高階組合(依賴 runner + domain + io)
│   └── pipelineMerge.ts      # 原 pipelineMerge.ts(move)
├── testMode.ts               # 留 top-level — cross-cutting(各 layer 都讀)
├── runner/                   # 不動(已分子目錄,結構健康)
├── qa/                       # 不動
└── cli/                      # 不動
```

**依賴方向**(嚴格單向,新 PR 加 lint rule 後可機械保證):

```
            ┌── services ──┐
            │              ▼
            │           runner ── qa ── cli ── remote
            │              │              │       │
            ▼              ▼              ▼       ▼
          system ─────── domain ──────────────── io
```

- `io/` 是底,不 import 任何 `server/lib/*`(除 `node:*`、`bun:*`、`shared/types`)
- `domain/` 只 import `io/` + `shared/types`
- `remote/` 只 import `io/` + `domain/`(`notifs.ts` 寫 jsonl 進 .runtime,要讀 `domain/projectDir.ensureRuntime`)
- `runner/` / `qa/` / `cli/` 可 import `io/` + `domain/` + `remote/`(`runner/ticketWatcher` 已 import fcm + push)
- `system/` 可 import 上述全部(`update.ts` 要 import `runner/orchestrator` 做 preflight 看有無 pipeline 在跑,才決定能否 swap binary)
- `services/` 可 import 全部下面層(`pipelineMerge.ts` 已 import runner + domain + io 三層)
- `testMode.ts` 被 domain / runner / qa 讀,自己不 import 任何 `server/lib/*`(cross-cutting,純資料 store)

**反向禁止**:
- `domain/` 禁 import `remote/` / `runner/` / `qa/` / `cli/` / `system/` / `services/`
- `io/` 禁 import 任何 `server/lib/*`
- `remote/` 禁 import `runner/` / `qa/` / `cli/` / `system/` / `services/`

## `pipelineDir.ts` 拆分對應表

| 新檔 | 原 `pipelineDir.ts` 的 export | 估行 |
|---|---|---|
| `domain/projectDir.ts` | `rootPath` / `runtimePath` / `ensureRuntime` / `hasInit` / `init` + `WORKTREE_INCLUDE_TEMPLATE` / `GITIGNORE_ENTRIES` + `ensureWorktreeIncludeTemplate` / `ensureGitignoreEntry`(private) | ~60 |
| `domain/projectConfig.ts` | `DEFAULT_CONFIG` / `ProjectConfig` / `ResolvedDefaults` / `readConfig` / `writeConfig` / `clampMaxParallel` / `getMaxParallel` / `normalizeCostLimitUsd` / `getResolvedDefaults` + 全 `DEFAULT_*` 常數 / `FIXED_MERGE_STRATEGY` / `MAX_PARALLEL_MIN` / `MAX_PARALLEL_MAX` / `DEFAULT_MAX_PARALLEL` / `DEFAULT_COST_LIMIT_USD` / `DEFAULT_AUTO_MERGE` | ~110 |
| `domain/pipeline.ts` | `generatePipelineId` / `listPipelines` / `pipelineFile` / `readPipeline` / `writePipeline` / `mutatePipeline` / `deletePipeline` + `SLUG_CHARS`(private) | ~140 |
| `domain/mergeTicket.ts` | `appendMergeTicket` | ~70 |

### 關鍵職責調整:`init()` 不再碰 `config.json`

**原**:`pipelineDir.init()` 內部會寫 `DEFAULT_CONFIG` 進 `config.json`(沒檔時),這讓 `init` 同時負責「dir 結構」+「config 預設」兩件事。

**新**:`projectDir.init()` 只管 `.vibe-pipeline/` 目錄結構 + `.gitignore` 條目 + `.worktreeinclude` 模板。**不碰 `config.json`**。`projectConfig.writeConfig()` 成為 config 唯一寫入口,自己負責「沒檔時寫 default」(走 `readConfig() ?? DEFAULT_CONFIG` 合併 + atomicWrite)。

**影響**:`/api/projects/:hash/init` route handler 原本一步 `pipelineDir.init()`,新走兩步 `projectDir.init() + projectConfig.writeConfig(default)`。動 route handler **唯一處**。

**為何這樣切**:
- `projectDir` 跟 `projectConfig` 互不 import → 沒循環風險
- `writeConfig` 變 config 唯一入口 → 一切跟 `config.json` 有關的 invariant(atomic write / fallback / clamp)集中一處
- 半 init 狀態(雷區踩過)依然 idempotent:任何 caller 想寫 config,`writeConfig` 內部仍會 `projectDir.init()` 先補齊 dir 結構

## 其他 rename / move 摘要

| 原 | 新 | 原因 |
|---|---|---|
| `spawn.ts` | `io/childSpawn.ts` | 消除跟 `runner/orchestrator/spawn.ts` 撞名 |
| `git.ts` | `io/git/index.ts` | 合併同概念,git helper 不再散兩層 |
| `projectStore.ts` | `domain/project.ts` | 統一 domain 概念命名(對稱 `pipeline` / `userConfig` / `auditLog`) |
| `notifs/store.ts` | `remote/notifs.ts` | 單檔目錄拍平 |
| `fcm/index.ts` | `remote/fcm.ts` | 同上 |
| `systemVersion.ts` | `system/version.ts` | 進 `system/` layer,名字脫掉 `system` 前綴 |
| `updater.ts` | `system/update.ts` | 同上 |

## 不改動範圍

- `runner/orchestrator/spawn.ts`(同名 file,不改)
- `runner/` 全部子結構
- `qa/` 全部子結構
- `cli/` 全部子結構
- `testMode.ts`(留 top-level)
- `push/` 子目錄(內兩檔職責不同,保留)

## Migration 策略

**單 PR,多 commit 階段化**(每階段 tsc + build 都過):

1. **Commit A — 拆 `pipelineDir.ts`**
   - 新增 `domain/projectDir.ts` / `projectConfig.ts` / `pipeline.ts` / `mergeTicket.ts`
   - 原 `server/lib/pipelineDir.ts` 改成 barrel re-export(全部 export 從新位置 re-export 出去),維持所有 caller 原 import 可用
   - 改 `routes/projects.ts` 內 `/api/projects/:hash/init` handler,改走 `projectDir.init() + projectConfig.writeConfig`(`init` 不再內寫 config)
   - 驗:`bun run build` + e2e mock 全綠

2. **Commit B — 搬其他全部檔**
   - 建 `io/` `domain/` `remote/` `system/` `services/` 目錄
   - 搬檔 + rename(spawn → childSpawn、projectStore → project、systemVersion → version 等)
   - **每個原 path 留 barrel re-export**(舊 import 仍可用)
   - 驗:`bun run build` 過

3. **Commit C — rewrite 所有 caller 的 import path**
   - server/routes / cli / tests / server/lib 內部互引 — 全機械 path 改寫到新位置
   - 估約 186 行 import 變更
   - 驗:`bun run build` + e2e mock 全綠

4. **Commit D — 刪 barrel**
   - 移除所有舊 path 的 re-export shim:
     - io 層搬遷:`atomicWrite.ts` / `jsonl.ts` / `fs.ts` / `hash.ts` / `paths.ts` / `dialog.ts` / `spawn.ts` / `git.ts`
     - domain 層搬遷:`pipelineDir.ts` / `projectStore.ts` / `userConfig.ts` / `auditLog.ts`
     - remote 層搬遷:`notifs/store.ts` / `fcm/index.ts`(整目錄刪)
     - system 層搬遷:`systemVersion.ts` / `updater.ts` / `depInstall.ts`
     - services 層搬遷:`pipelineMerge.ts`
   - 移除空目錄:`notifs/` / `fcm/`(只剩 barrel 後拆光)
   - 驗:`bun run build` + e2e mock 全綠;grep regression(下節)零命中

5. **Commit E — 文件同步**
   - `docs/refs/repo-structure.md` server/lib 段重寫對齊新 layout
   - `.claude/skills/vibe-pipeline-backend/SKILL.md` 內若有提 `server/lib/X` 具體 path 跟著改

**為何分這 5 階段**:每個 commit 結束 build / e2e 都綠,任何階段出問題只需 revert 該 commit 不會牽動其他。Commit B 跟 C 拆開是因為 B 改檔位置 + 留 barrel,C 純改 caller path —— 兩個動作可分審分驗,review diff 不混。

## 驗證

- **`bun run build`** 全綠(tsc -b + vite build)
- **`bun run test:e2e`** 全綠(playwright mock 模式 — 覆蓋 project / pipeline / QA / ticket / runner / merge / notif / topbar 全 path,server/lib 動到的全 caller 都會打到)
- **`vbpl` CLI 全 noun verb sanity**:`vbpl project list` / `vbpl pipeline list / show / status` / `vbpl ticket add` / `vbpl config get` — CLI 直接 import `server/lib/*`,任何 import path 錯會即時 throw
- **grep regression**:Commit D 後下列 pattern 全零命中(只查 `from "..."` import,不查 string literal):
  ```
  rg 'from ["'\''].*lib/(atomicWrite|jsonl|fs|hash|paths|dialog|spawn|git\.ts|pipelineDir|projectStore|userConfig|auditLog|notifs/store|fcm/index|systemVersion|updater|depInstall|pipelineMerge)["'\'']' src server cli tests
  ```
- **依賴方向 lint**(optional follow-up):eslint-plugin-boundaries 或 dependency-cruiser 設規則 `io/` 不可 import `server/lib/*`、`domain/` 不可 import `runner/qa/cli/services/`,放 CI 機械防 regression

## 風險

| 風險 | 緩解 |
|---|---|
| Barrel re-export 階段被誤認為「兩處都可寫」,新 code 寫舊 path | Commit D 移除 barrel,grep 防 regression;Commit B/C 兩 commit 短時間連跑 |
| Windows path 大小寫(`git.ts` 跟 `git/` 子目錄並存階段) | Commit A 不動 git;`git.ts` 在 Commit B 才搬入 `io/git/index.ts`,同 commit 內刪 top-level `git.ts`;測 case-sensitive vs case-insensitive 各跑一次 |
| `init()` 行為微調(不再寫 config.json)漏改 caller | 全 grep `pipelineDir.init` 跟 `from .*pipelineDir` import 後再做;只一個 caller(`routes/projects.ts`)會打到 |
| 跨 provider sub-agent worktree 內 import 路徑跟主 repo 不同步 | self-dogfood pipeline 在 Commit D 後跑一個 dummy ticket 驗 sub-agent 能正常 build |

## 後續

- 完成後 `docs/refs/repo-structure.md` 改完,刪本 design doc(歸 archive)還是留作 reference?**留作 reference**(歸 `docs/refs/archive/` 後 link 仍可訪)。
- 下一條:**前端 primitive ownership cleanup**(TODO #6,串行排隊)

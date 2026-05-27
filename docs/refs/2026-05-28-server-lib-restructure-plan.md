# server/lib 分層重構 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec**: [`docs/refs/2026-05-28-server-lib-restructure-design.md`](2026-05-28-server-lib-restructure-design.md)

**Goal**: 把 `server/lib/` 從扁平 25+ 檔重構成五層分層(io / domain / remote / system / services + testMode top-level + runner / qa / cli 不動),拆 `pipelineDir.ts` 5 職責,零行為變動。

**Architecture**: 單 PR 五階段 commit,每階段 build + e2e 全綠才推下一步;舊 path 留 barrel re-export 直到 caller 全部改完,最後刪 barrel。

**Tech Stack**: Bun(server runtime + test runner)/ TypeScript / Vite(frontend build)/ Playwright(e2e mock)

---

## File Structure(動到的全部檔)

### 新建檔(20)
```
server/lib/io/atomicWrite.ts
server/lib/io/jsonl.ts
server/lib/io/fs.ts
server/lib/io/hash.ts
server/lib/io/paths.ts
server/lib/io/dialog.ts
server/lib/io/childSpawn.ts             # 原 spawn.ts(rename)
server/lib/io/git/index.ts              # 原 git.ts
server/lib/io/git/worktree.ts           # 原 git/worktree.ts
server/lib/domain/project.ts            # 原 projectStore.ts(rename)
server/lib/domain/userConfig.ts
server/lib/domain/auditLog.ts
server/lib/domain/projectDir.ts         # NEW(pipelineDir.ts 拆出)
server/lib/domain/projectConfig.ts      # NEW(pipelineDir.ts 拆出)
server/lib/domain/pipeline.ts           # NEW(pipelineDir.ts 拆出)
server/lib/domain/mergeTicket.ts        # NEW(pipelineDir.ts 拆出)
server/lib/remote/notifs.ts             # 原 notifs/store.ts
server/lib/remote/fcm.ts                # 原 fcm/index.ts
server/lib/remote/push/gatewayToken.ts
server/lib/remote/push/tokenStore.ts
server/lib/system/version.ts            # 原 systemVersion.ts
server/lib/system/update.ts             # 原 updater.ts
server/lib/system/depInstall.ts
server/lib/services/pipelineMerge.ts
```

### 刪除檔(commit D)
```
server/lib/atomicWrite.ts
server/lib/jsonl.ts
server/lib/fs.ts
server/lib/hash.ts
server/lib/paths.ts
server/lib/dialog.ts
server/lib/spawn.ts
server/lib/git.ts
server/lib/git/worktree.ts          # 整個 git/ 目錄(舊位置)
server/lib/pipelineDir.ts
server/lib/projectStore.ts
server/lib/userConfig.ts
server/lib/auditLog.ts
server/lib/notifs/store.ts          # 整個 notifs/ 目錄
server/lib/fcm/index.ts             # 整個 fcm/ 目錄
server/lib/push/                    # 整個 push/ 目錄(搬到 remote/push/)
server/lib/systemVersion.ts
server/lib/updater.ts
server/lib/depInstall.ts
server/lib/pipelineMerge.ts
```

### 修改檔(非搬遷)
```
server/routes/projects.ts           # init handler 改兩步(commit A)
docs/refs/repo-structure.md         # server/lib 段重寫(commit E)
.claude/skills/vibe-pipeline-backend/SKILL.md  # 若有 server/lib/X 具體 path 引用(commit E)
```

### 不動檔
- `server/lib/runner/` 全部子結構(包括 `runner/orchestrator/spawn.ts`)
- `server/lib/qa/` 全部
- `server/lib/cli/` 全部
- `server/lib/testMode.ts`(留 top-level,cross-cutting)

---

## Baseline Verification

### Task 0: 確認 build + e2e 基線綠

**Files**: 無(只跑驗證)

- [ ] **Step 1: 確認在 main branch + clean tree**

```bash
git status
```
Expected: `nothing to commit, working tree clean`,branch 在 main 且至少有 `cfc1d60` spec commit

- [ ] **Step 2: 跑 build**

```bash
bun run build
```
Expected: tsc -b 過 + vite build 過,exit 0

- [ ] **Step 3: 跑 e2e mock**

```bash
bun run test:e2e
```
Expected: 全綠,記錄通過數 / 跑多久(後續每個 commit 結束都會跑這條,作對照)

- [ ] **Step 4: 不必 commit**(無檔變動)

---

## Commit A: 拆 `pipelineDir.ts` 為 4 檔

策略:**先建 4 個新檔**(從原檔複製對應段落),**原 `pipelineDir.ts` 改 barrel re-export**(全部既有 caller 不動),**改一處 route handler**(配合 init 不再寫 config 的職責調整)。

### Task A1: 建 `domain/projectDir.ts`

**Files**:
- Create: `server/lib/domain/projectDir.ts`

從原 `server/lib/pipelineDir.ts` 抽出 `.vibe-pipeline/` 目錄結構 + gitignore + worktreeinclude 相關段落。

- [ ] **Step 1: 建檔**

```typescript
// server/lib/domain/projectDir.ts
// .vibe-pipeline/ 目錄結構 + gitignore + worktreeinclude 模板。
// 不碰 config.json — 由 projectConfig.writeConfig 處理。

import { join } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";

const DIR = ".vibe-pipeline";
const GITIGNORE_ENTRIES = [`${DIR}/`];

export function rootPath(projectPath: string): string {
  return join(projectPath, DIR);
}

export function runtimePath(projectPath: string, sub = ""): string {
  return join(rootPath(projectPath), ".runtime", sub);
}

export function ensureRuntime(projectPath: string, sub = ""): string {
  const p = runtimePath(projectPath, sub);
  mkdirSync(p, { recursive: true });
  return p;
}

export function hasInit(projectPath: string): boolean {
  const p = rootPath(projectPath);
  return existsSync(p) && statSync(p).isDirectory();
}

// idempotent:`.vibe-pipeline/` 已存在但內容缺(早期 partial init 失敗留的殘骸)→ 補齊;
// 全齊 → 也視為成功(no-op),不再 throw 'already_initialized'。
// 只在 path 存在但不是 dir(被檔案佔住等)時 throw。
// 不再寫 config.json — projectConfig.writeConfig 負責。
export async function init(projectPath: string): Promise<void> {
  const root = rootPath(projectPath);
  if (existsSync(root) && !statSync(root).isDirectory()) {
    throw new Error(".vibe-pipeline path is not a directory");
  }
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "pipelines"), { recursive: true });
  mkdirSync(join(root, ".runtime"), { recursive: true });
  for (const entry of GITIGNORE_ENTRIES) {
    await ensureGitignoreEntry(projectPath, entry);
  }
  await ensureWorktreeIncludeTemplate(projectPath);
}

const WORKTREE_INCLUDE_TEMPLATE = `# worktree 複製清單 — 開 worktree 時要一起帶進去的 gitignored 檔
# 用 .gitignore 語法;只有「match 且本身被 gitignore」的檔會被複製(tracked 檔自動排除)。
# 取消下面註解並改成這個 repo 實際的憑證 / 環境檔:
# .env
# .env.local
`;

async function ensureWorktreeIncludeTemplate(projectPath: string): Promise<void> {
  const wti = join(projectPath, ".worktreeinclude");
  if (existsSync(wti)) return;
  await Bun.write(wti, WORKTREE_INCLUDE_TEMPLATE);
}

async function ensureGitignoreEntry(projectPath: string, entry: string): Promise<void> {
  const gi = join(projectPath, ".gitignore");
  let content = "";
  if (existsSync(gi)) content = await Bun.file(gi).text();
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry)) return;
  const next = (content.endsWith("\n") || content === "" ? content : content + "\n") + entry + "\n";
  await Bun.write(gi, next);
}
```

- [ ] **Step 2: 確認 tsc 過**

```bash
bun run build
```
Expected: pass(新檔還沒被 import,但 tsc 會 type-check 它)

### Task A2: 建 `domain/projectConfig.ts`

**Files**:
- Create: `server/lib/domain/projectConfig.ts`

從原 `pipelineDir.ts` 抽 config 相關全部。`writeConfig` 自己呼叫 `projectDir.init` 確保 dir 結構,然後 atomic write `config.json`。**新增:`writeConfig` 沒檔時自帶 default**(原 `init` 內寫 default 的職責搬過來)。

- [ ] **Step 1: 建檔**

```typescript
// server/lib/domain/projectConfig.ts
// per-target .vibe-pipeline/config.json 讀寫 + clamp + getResolvedDefaults。
// 唯一的 config.json 寫入口。沒檔時 writeConfig 會帶 default。

import { join } from "node:path";
import { existsSync } from "node:fs";
import { atomicWriteJson } from "../io/atomicWrite";
import { currentBranch } from "../io/git";
import * as projectDir from "./projectDir";

export const DEFAULT_MAX_PARALLEL = 2;
export const MAX_PARALLEL_MIN = 1;
export const MAX_PARALLEL_MAX = 8;

// merge strategy 已鎖定 merge --no-ff(squash 跟新版 auto-rebase + sync 不相容;ff-only 條件太苛)。
// 留 const 供 mergeTicketPrompt / 任何呼叫端參照,不再走 config。
export const FIXED_MERGE_STRATEGY = "merge" as const;
export const DEFAULT_COST_LIMIT_USD = 0;
export const DEFAULT_AUTO_MERGE = false;

const DEFAULT_CONFIG = {
  defaults: {
    base_branch: "main",
    max_parallel: DEFAULT_MAX_PARALLEL,
    cost_limit_usd: DEFAULT_COST_LIMIT_USD,
    auto_merge: DEFAULT_AUTO_MERGE,
  },
  scripts: {
    setup: "",
    dev: "",
    cleanup: "",
  },
  qa: {
    openingMessage: "幫我建一張 ticket。",
  },
};

export type ProjectConfig = {
  defaults?: {
    base_branch?: string;
    max_parallel?: number;
    cost_limit_usd?: number;
    auto_merge?: boolean;
  };
  scripts?: { setup?: string; dev?: string; cleanup?: string };
  qa?: { openingMessage?: string };
};

export type ResolvedDefaults = {
  base_branch: string;
  max_parallel: number;
  cost_limit_usd: number;
  auto_merge: boolean;
};

export async function readConfig(projectPath: string): Promise<ProjectConfig> {
  const file = join(projectDir.rootPath(projectPath), "config.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(await Bun.file(file).text());
  } catch {
    return {};
  }
}

// writeConfig 是 config.json 唯一寫入口。
// 內部走 projectDir.init() 補齊 dir 結構(idempotent),再 atomic write。
// 沒帶 cfg 時寫 DEFAULT_CONFIG(取代舊 init 內寫 default 的行為)。
export async function writeConfig(projectPath: string, cfg?: ProjectConfig): Promise<void> {
  await projectDir.init(projectPath);
  const file = join(projectDir.rootPath(projectPath), "config.json");
  if (!cfg) {
    if (existsSync(file)) return;
    await atomicWriteJson(file, DEFAULT_CONFIG);
    return;
  }
  await atomicWriteJson(file, cfg);
}

export function clampMaxParallel(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_MAX_PARALLEL;
  if (n < MAX_PARALLEL_MIN) return MAX_PARALLEL_MIN;
  if (n > MAX_PARALLEL_MAX) return MAX_PARALLEL_MAX;
  return n;
}

export async function getMaxParallel(projectPath: string): Promise<number> {
  const cfg = await readConfig(projectPath);
  return clampMaxParallel(cfg.defaults?.max_parallel);
}

export function normalizeCostLimitUsd(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return DEFAULT_COST_LIMIT_USD;
  return raw;
}

export async function getResolvedDefaults(projectPath: string): Promise<ResolvedDefaults> {
  const cfg = await readConfig(projectPath);
  const d = cfg.defaults ?? {};
  let base_branch =
    typeof d.base_branch === "string" && d.base_branch.trim().length > 0 ? d.base_branch.trim() : "";
  if (!base_branch) {
    try {
      const cur = await currentBranch(projectPath);
      base_branch = cur ?? "";
    } catch {
      base_branch = "";
    }
  }
  return {
    base_branch,
    max_parallel: clampMaxParallel(d.max_parallel),
    cost_limit_usd: normalizeCostLimitUsd(d.cost_limit_usd),
    auto_merge: typeof d.auto_merge === "boolean" ? d.auto_merge : DEFAULT_AUTO_MERGE,
  };
}
```

**注意**:此檔已 import 新位置 `../io/atomicWrite` 和 `../io/git`,但這兩個檔 commit A 還沒建。**這裡需要先用舊位置**(`../atomicWrite` / `../git`)讓 commit A 可獨立 build,commit B 才連帶改。

- [ ] **Step 2: 修正 import 路徑用舊 path**

把 step 1 內 `from "../io/atomicWrite"` 改成 `from "../atomicWrite"`,`from "../io/git"` 改成 `from "../git"`。Commit B 搬 io/ 時會把這兩個 import 跟著 rewrite。

- [ ] **Step 3: tsc 過**

```bash
bun run build
```

### Task A3: 建 `domain/pipeline.ts`

**Files**:
- Create: `server/lib/domain/pipeline.ts`

從原 `pipelineDir.ts` 抽 pipeline CRUD + mutate。

- [ ] **Step 1: 建檔**

```typescript
// server/lib/domain/pipeline.ts
// pipeline.json CRUD + race-safe mutate helper。
// 寫入時若 state 變動 → 自動 appendStateChange 到 audit log。

import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { atomicWriteJson } from "../atomicWrite";
import { exists as worktreeExists } from "../git/worktree";
import { appendStateChange } from "../auditLog";
import * as projectDir from "./projectDir";
import type { Pipeline } from "../../../shared/types";

const SLUG_CHARS = /[^a-z0-9-_]+/g;

export function generatePipelineId(name: string): string {
  const ts = Date.now().toString(16).padStart(12, "0");
  const slug = name.toLowerCase().replace(SLUG_CHARS, "-").replace(/^-+|-+$/g, "") || "pipeline";
  return `${ts}-${slug}`;
}

export function pipelineFile(projectPath: string, id: string): string {
  return join(projectDir.rootPath(projectPath), "pipelines", `${id}.json`);
}

export async function listPipelines(projectPath: string): Promise<unknown[]> {
  const dir = join(projectDir.rootPath(projectPath), "pipelines");
  if (!existsSync(dir)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const obj = JSON.parse(await Bun.file(join(dir, f)).text()) as Record<string, unknown>;
      if (typeof obj.createdAt !== "number") {
        const idStr = typeof obj.id === "string" ? obj.id : "";
        const tsHex = idStr.split("-")[0];
        const ts = tsHex && /^[0-9a-f]+$/i.test(tsHex) ? parseInt(tsHex, 16) : 0;
        obj.createdAt = Number.isFinite(ts) ? ts : 0;
      }
      if (typeof obj.id === "string") {
        obj.hasWorktree = worktreeExists(projectPath, obj.id);
      }
      out.push(obj);
    } catch {}
  }
  out.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
  return out;
}

export async function readPipeline(projectPath: string, id: string): Promise<unknown | null> {
  const file = pipelineFile(projectPath, id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await Bun.file(file).text());
  } catch {
    return null;
  }
}

export async function writePipeline(
  projectPath: string,
  id: string,
  data: unknown,
  opts?: { source?: string; sourceDetail?: string; prevStateHint?: string },
): Promise<void> {
  let prevState: string | undefined = opts?.prevStateHint;
  if (prevState === undefined) {
    try {
      const before = (await readPipeline(projectPath, id)) as { state?: unknown } | null;
      prevState = typeof before?.state === "string" ? before.state : undefined;
    } catch {
      prevState = undefined;
    }
  }
  const file = pipelineFile(projectPath, id);
  mkdirSync(dirname(file), { recursive: true });
  await atomicWriteJson(file, data);
  const nextStateRaw = (data as { state?: unknown } | null)?.state;
  const nextState = typeof nextStateRaw === "string" ? nextStateRaw : undefined;
  if (prevState !== nextState && (prevState !== undefined || nextState !== undefined)) {
    appendStateChange({
      projectPath,
      pipelineId: id,
      from: prevState ?? "(none)",
      to: nextState ?? "(none)",
      source: opts?.source ?? "unknown",
      sourceDetail: opts?.sourceDetail,
    });
  }
}

// race-safe read-modify-write:read → 同步 mutator → write,中間零 await。
// mutator 必須 sync,任何慢操作寫在外面,callsite 自己處理。
export async function mutatePipeline(
  projectPath: string,
  id: string,
  mutator: (p: Pipeline) => Pipeline,
  opts?: { source?: string; sourceDetail?: string },
): Promise<Pipeline> {
  const cur = (await readPipeline(projectPath, id)) as Pipeline | null;
  if (!cur) throw new Error("Pipeline not found: " + id);
  const prevState = typeof (cur as { state?: unknown }).state === "string"
    ? ((cur as { state: string }).state)
    : undefined;
  const next = mutator(cur);
  await writePipeline(projectPath, id, next, {
    source: opts?.source,
    sourceDetail: opts?.sourceDetail,
    prevStateHint: prevState,
  });
  return next;
}

export function deletePipeline(projectPath: string, id: string): boolean {
  const file = pipelineFile(projectPath, id);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}
```

- [ ] **Step 2: tsc 過**

```bash
bun run build
```

### Task A4: 建 `domain/mergeTicket.ts`

**Files**:
- Create: `server/lib/domain/mergeTicket.ts`

從原 `pipelineDir.ts` 抽 `appendMergeTicket` 單函式。

- [ ] **Step 1: 建檔**

```typescript
// server/lib/domain/mergeTicket.ts
// Synthetic merge ticket(_synthetic: true,user 不可改 / 不可刪)。
// 已有失敗 / paused 的 merge ticket → reset 它,不重複 append。

import { readPipeline, writePipeline } from "./pipeline";

export async function appendMergeTicket(opts: {
  projectPath: string;
  pipelineId: string;
  prompt: string;
}): Promise<{ ok: true; ticket: Record<string, unknown>; reused: boolean } | { ok: false; error: string }> {
  const { projectPath, pipelineId, prompt } = opts;
  const p = (await readPipeline(projectPath, pipelineId)) as {
    state?: string;
    tickets?: Array<{ status?: string; mode?: string; n?: number; [k: string]: unknown }>;
    [k: string]: unknown;
  } | null;
  if (!p) return { ok: false, error: "Pipeline not found" };
  if (p.state === "merged") return { ok: false, error: "Pipeline 已 merged" };
  const tickets = p.tickets ?? [];
  const realTicketsDone =
    tickets.filter((t) => t.mode !== "merge").every((t) => t.status === "done") &&
    tickets.filter((t) => t.mode !== "merge").length > 0;
  if (!realTicketsDone) return { ok: false, error: "還有 ticket 未 done" };
  const existingIdx = tickets.findIndex((t) => t.mode === "merge");
  if (existingIdx !== -1) {
    const existing = tickets[existingIdx];
    if (existing.status === "running") return { ok: false, error: "merge ticket 正在跑" };
    if (existing.status === "done") return { ok: false, error: "merge ticket 已完成(state 應為 merged)" };
    tickets[existingIdx] = {
      ...existing,
      status: "ready",
      prompt,
      iter: undefined,
      startedAt: undefined,
      endedAt: undefined,
      reason: undefined,
    };
    await writePipeline(projectPath, pipelineId, { ...p, tickets }, {
      source: "appendMergeTicket",
      sourceDetail: "reuse existing merge ticket",
      prevStateHint: typeof p.state === "string" ? p.state : undefined,
    });
    return { ok: true, ticket: tickets[existingIdx], reused: true };
  }
  const nextN = tickets.reduce((m, t) => Math.max(m, typeof t.n === "number" ? t.n : 0), 0) + 1;
  const ts = Date.now().toString(16).padStart(12, "0");
  const ticket = {
    id: `t${nextN}-${ts}`,
    n: nextN,
    title: "AI 合併 → base branch",
    goal: "把 pipeline branch 合併到 base branch,衝突自動解,跑驗證",
    acceptance: ["git merge 成功 (base 上有新 commit)", "tsc / test / build 通過(若 project 有)"],
    prompt,
    mode: "merge",
    status: "ready",
    iterLimit: 5,
    iterStopAtLimit: true,
    _synthetic: true,
  };
  tickets.push(ticket);
  await writePipeline(projectPath, pipelineId, { ...p, tickets }, {
    source: "appendMergeTicket",
    sourceDetail: "append new merge ticket",
    prevStateHint: typeof p.state === "string" ? p.state : undefined,
  });
  return { ok: true, ticket, reused: false };
}
```

- [ ] **Step 2: tsc 過**

```bash
bun run build
```

### Task A5: 把 `server/lib/pipelineDir.ts` 改成 barrel re-export

**Files**:
- Modify: `server/lib/pipelineDir.ts`(全內容換成 re-export)

所有現有 caller 仍 import `../pipelineDir`,維持向後相容直到 commit C 重寫 import path。

- [ ] **Step 1: 整檔內容換成 re-export**

```typescript
// server/lib/pipelineDir.ts
// BARREL re-export(commit A 後過渡,commit D 刪)。
// 新 code 請直接從 domain/projectDir | projectConfig | pipeline | mergeTicket import。

export {
  rootPath,
  runtimePath,
  ensureRuntime,
  hasInit,
  init,
} from "./domain/projectDir";

export {
  DEFAULT_MAX_PARALLEL,
  MAX_PARALLEL_MIN,
  MAX_PARALLEL_MAX,
  FIXED_MERGE_STRATEGY,
  DEFAULT_COST_LIMIT_USD,
  DEFAULT_AUTO_MERGE,
  readConfig,
  writeConfig,
  clampMaxParallel,
  getMaxParallel,
  normalizeCostLimitUsd,
  getResolvedDefaults,
} from "./domain/projectConfig";
export type { ProjectConfig, ResolvedDefaults } from "./domain/projectConfig";

export {
  generatePipelineId,
  pipelineFile,
  listPipelines,
  readPipeline,
  writePipeline,
  mutatePipeline,
  deletePipeline,
} from "./domain/pipeline";

export { appendMergeTicket } from "./domain/mergeTicket";
```

- [ ] **Step 2: tsc 過 + e2e mock 跑一次**

```bash
bun run build && bun run test:e2e
```
Expected: 全綠

### Task A6: 改 `routes/projects.ts` init handler 兩步式

**Files**:
- Modify: `server/routes/projects.ts`(只動 `/api/projects/:hash/init` handler)

- [ ] **Step 1: 找到原 handler**

```bash
rg -n "pipelineDir\.init|export async function init" server/routes/projects.ts
```
Expected: 找到呼叫 `pipelineDir.init(projectPath)` 的 init handler 位置

- [ ] **Step 2: 改兩步**

把原本一行的 `await pipelineDir.init(projectPath)` 改成:
```typescript
await pipelineDir.init(projectPath);
await pipelineDir.writeConfig(projectPath);  // 沒檔時自帶 default
```

(barrel 仍導出 `init` 跟 `writeConfig`,寫法不變。`writeConfig(projectPath)` 不帶 `cfg` 時走 default 路徑。)

- [ ] **Step 3: tsc + e2e**

```bash
bun run build && bun run test:e2e
```
Expected: 全綠(特別跑 init 相關 e2e — 新 project init flow 應通過)

### Task A7: Commit A

- [ ] **Step 1: stage + commit**

```bash
git add server/lib/domain/ server/lib/pipelineDir.ts server/routes/projects.ts
git status  # 確認 stage 內容是這 6 個檔(domain/ 4 個 + 修改 2 個)
git commit -m "refactor(server): 拆 pipelineDir.ts 為 domain/{projectDir,projectConfig,pipeline,mergeTicket}

- pipelineDir.ts 5 職責拆 4 檔
- init() 不再寫 config.json,改由 writeConfig 負責 default
- routes/projects.ts init handler 改兩步式
- pipelineDir.ts 保留為 barrel re-export(commit D 刪)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: 確認 baseline 仍綠**

```bash
bun run build && bun run test:e2e
```
Expected: 全綠

---

## Commit B: 搬其他全部檔(io / 其他 domain / remote / system / services)+ barrel re-exports

策略:每個檔搬到新位置 + 同 commit 內原 path 留 barrel。內部互引(如 `domain/pipeline.ts` 還在 import `../atomicWrite`)在這個 commit 一併改成新 path。

### Task B1: 建 `io/` 層

**Files**:
- Create: `server/lib/io/atomicWrite.ts`(整檔 copy 自舊位置)
- Create: `server/lib/io/jsonl.ts`
- Create: `server/lib/io/fs.ts`
- Create: `server/lib/io/hash.ts`
- Create: `server/lib/io/paths.ts`
- Create: `server/lib/io/dialog.ts`
- Create: `server/lib/io/childSpawn.ts`(copy 自 `spawn.ts`)
- Create: `server/lib/io/git/index.ts`(copy 自 `git.ts`)
- Create: `server/lib/io/git/worktree.ts`(copy 自 `git/worktree.ts`)

- [ ] **Step 1: 機械 copy 9 個檔到新位置**

```bash
mkdir -p server/lib/io/git
cp server/lib/atomicWrite.ts server/lib/io/atomicWrite.ts
cp server/lib/jsonl.ts       server/lib/io/jsonl.ts
cp server/lib/fs.ts          server/lib/io/fs.ts
cp server/lib/hash.ts        server/lib/io/hash.ts
cp server/lib/paths.ts       server/lib/io/paths.ts
cp server/lib/dialog.ts      server/lib/io/dialog.ts
cp server/lib/spawn.ts       server/lib/io/childSpawn.ts
cp server/lib/git.ts         server/lib/io/git/index.ts
cp server/lib/git/worktree.ts server/lib/io/git/worktree.ts
```

- [ ] **Step 2: 修新檔內部 relative import**

`io/dialog.ts` 內原本 `from "./spawn"` → 改 `from "./childSpawn"`
`io/git/index.ts` 內原本 `from "./spawn"` → 改 `from "../childSpawn"`
`io/git/worktree.ts` 內原本 `from "../hash"` 不變(仍 `../hash`,但新層級下要對到 `io/hash` 而非 `lib/hash` — 它已在 io 內,所以 `../hash` 解到 `io/hash.ts`,OK)
`io/git/worktree.ts` 內 `from "../paths"` 同理(對到 `io/paths.ts`,OK)
`io/git/worktree.ts` 內 `from "../spawn"` → 改 `from "../childSpawn"`

- [ ] **Step 3: 改舊 path 為 barrel re-export**

把舊 `server/lib/atomicWrite.ts` 內容換成 `export * from "./io/atomicWrite";`,其他 8 個檔比照。
舊 `server/lib/spawn.ts` 換成 `export * from "./io/childSpawn";`
舊 `server/lib/git.ts` 換成 `export * from "./io/git";`
舊 `server/lib/git/worktree.ts` 換成 `export * from "../io/git/worktree";`

- [ ] **Step 4: 改 commit A 內新建檔的 import 對到 io 新位置**

`server/lib/domain/projectConfig.ts` 內 `from "../atomicWrite"` → `from "../io/atomicWrite"`
`server/lib/domain/projectConfig.ts` 內 `from "../git"` → `from "../io/git"`
`server/lib/domain/pipeline.ts` 內 `from "../atomicWrite"` → `from "../io/atomicWrite"`
`server/lib/domain/pipeline.ts` 內 `from "../git/worktree"` → `from "../io/git/worktree"`

- [ ] **Step 5: tsc 過**

```bash
bun run build
```
Expected: 全綠

### Task B2: 搬其他 domain / remote / system / services

**Files**:
- Create: `server/lib/domain/project.ts`(copy 自 `projectStore.ts`)
- Create: `server/lib/domain/userConfig.ts`(copy 自 `userConfig.ts`)
- Create: `server/lib/domain/auditLog.ts`(copy 自 `auditLog.ts`)
- Create: `server/lib/remote/notifs.ts`(copy 自 `notifs/store.ts`)
- Create: `server/lib/remote/fcm.ts`(copy 自 `fcm/index.ts`)
- Create: `server/lib/remote/push/gatewayToken.ts`(copy 自 `push/gatewayToken.ts`)
- Create: `server/lib/remote/push/tokenStore.ts`(copy 自 `push/tokenStore.ts`)
- Create: `server/lib/system/version.ts`(copy 自 `systemVersion.ts`)
- Create: `server/lib/system/update.ts`(copy 自 `updater.ts`)
- Create: `server/lib/system/depInstall.ts`(copy 自 `depInstall.ts`)
- Create: `server/lib/services/pipelineMerge.ts`(copy 自 `pipelineMerge.ts`)

- [ ] **Step 1: 機械 copy**

```bash
mkdir -p server/lib/remote/push server/lib/system server/lib/services
cp server/lib/projectStore.ts    server/lib/domain/project.ts
cp server/lib/userConfig.ts      server/lib/domain/userConfig.ts
cp server/lib/auditLog.ts        server/lib/domain/auditLog.ts
cp server/lib/notifs/store.ts    server/lib/remote/notifs.ts
cp server/lib/fcm/index.ts       server/lib/remote/fcm.ts
cp server/lib/push/gatewayToken.ts server/lib/remote/push/gatewayToken.ts
cp server/lib/push/tokenStore.ts   server/lib/remote/push/tokenStore.ts
cp server/lib/systemVersion.ts   server/lib/system/version.ts
cp server/lib/updater.ts         server/lib/system/update.ts
cp server/lib/depInstall.ts      server/lib/system/depInstall.ts
cp server/lib/pipelineMerge.ts   server/lib/services/pipelineMerge.ts
```

- [ ] **Step 2: 修新檔內部 import 對到新 path**

依下表逐檔改:

| 新檔 | 原 import | 改成 |
|---|---|---|
| `domain/project.ts` | `from "./hash"` | `from "../io/hash"` |
| `domain/project.ts` | `from "./paths"` | `from "../io/paths"` |
| `domain/project.ts` | `from "./atomicWrite"` | `from "../io/atomicWrite"` |
| `domain/userConfig.ts` | `from "./paths"` | `from "../io/paths"` |
| `domain/userConfig.ts` | `from "./atomicWrite"` | `from "../io/atomicWrite"` |
| `domain/auditLog.ts` | `from "./jsonl"` | `from "../io/jsonl"` |
| `remote/notifs.ts` | `from "../pipelineDir"` | `from "../domain/projectDir"`(只用 `ensureRuntime`) |
| `remote/notifs.ts` | `from "../jsonl"` | `from "../io/jsonl"` |
| `remote/fcm.ts` | `from "../push/gatewayToken"` | `from "./push/gatewayToken"` |
| `remote/push/gatewayToken.ts` | `from "../paths"` | `from "../../io/paths"` |
| `remote/push/gatewayToken.ts` | `from "../atomicWrite"` | `from "../../io/atomicWrite"` |
| `remote/push/tokenStore.ts` | `from "./gatewayToken"` | (內部 relative 不變) |
| `system/version.ts` | `from "./spawn"` | `from "../io/childSpawn"` |
| `system/update.ts` | `from "./paths"` | `from "../io/paths"` |
| `system/update.ts` | `from "./systemVersion"` | `from "./version"` |
| `system/update.ts` | `from "./runner/orchestrator"` | `from "../runner/orchestrator"` |
| `system/depInstall.ts` | `from "./spawn"` | `from "../io/childSpawn"` |
| `services/pipelineMerge.ts` | `from "./pipelineDir"` | `from "../domain/pipeline"` / `../domain/projectConfig` / `../domain/mergeTicket`(依用到的 export 分) |
| `services/pipelineMerge.ts` | `from "./runner/orchestrator"` | `from "../runner/orchestrator"` |
| `services/pipelineMerge.ts` | `from "./git"` | `from "../io/git"` |
| `services/pipelineMerge.ts` | `from "./git/worktree"` | `from "../io/git/worktree"` |
| `services/pipelineMerge.ts` | `from "./notifs/store"` | `from "../remote/notifs"` |
| `services/pipelineMerge.ts` | `from "./runner/mergeTicketPrompt"` | `from "../runner/mergeTicketPrompt"` |
| `services/pipelineMerge.ts` | `from "./userConfig"` | `from "../domain/userConfig"` |
| `services/pipelineMerge.ts` | `from "./depInstall"` | `from "../system/depInstall"` |
| `services/pipelineMerge.ts` | `from "./spawn"` | `from "../io/childSpawn"` |

**做法**:逐檔開、grep `from "\./`/`from "\.\.`、對照表改。

- [ ] **Step 3: 改舊 path 為 barrel re-export**

每個原 top-level 檔內容換成 `export * from "<new path>";`。例:
```typescript
// server/lib/projectStore.ts → barrel
export * from "./domain/project";
```
```typescript
// server/lib/notifs/store.ts → barrel
export * from "../remote/notifs";
```
全列表(11 個):
- `server/lib/projectStore.ts` → `./domain/project`
- `server/lib/userConfig.ts` → `./domain/userConfig`
- `server/lib/auditLog.ts` → `./domain/auditLog`
- `server/lib/notifs/store.ts` → `../remote/notifs`
- `server/lib/fcm/index.ts` → `../remote/fcm`
- `server/lib/push/gatewayToken.ts` → `../remote/push/gatewayToken`
- `server/lib/push/tokenStore.ts` → `../remote/push/tokenStore`
- `server/lib/systemVersion.ts` → `./system/version`
- `server/lib/updater.ts` → `./system/update`
- `server/lib/depInstall.ts` → `./system/depInstall`
- `server/lib/pipelineMerge.ts` → `./services/pipelineMerge`

- [ ] **Step 4: tsc + e2e**

```bash
bun run build && bun run test:e2e
```
Expected: 全綠

### Task B3: Commit B

- [ ] **Step 1: stage + commit**

```bash
git add server/lib/io/ server/lib/domain/ server/lib/remote/ server/lib/system/ server/lib/services/ \
        server/lib/atomicWrite.ts server/lib/jsonl.ts server/lib/fs.ts server/lib/hash.ts \
        server/lib/paths.ts server/lib/dialog.ts server/lib/spawn.ts server/lib/git.ts \
        server/lib/git/worktree.ts server/lib/projectStore.ts server/lib/userConfig.ts \
        server/lib/auditLog.ts server/lib/notifs/store.ts server/lib/fcm/index.ts \
        server/lib/push/ server/lib/systemVersion.ts server/lib/updater.ts \
        server/lib/depInstall.ts server/lib/pipelineMerge.ts
git status  # 確認 stage 範圍
git commit -m "refactor(server): 搬遷 server/lib 到五層分層 + barrel re-exports

- 建 io/ domain/ remote/ system/ services/ 五層
- 搬 9 個 io 檔(含 spawn → childSpawn rename / git.ts 併入 io/git/)
- 搬 3 個 domain 檔(projectStore → project rename)
- 搬 4 個 remote 檔(notifs / fcm 拍平)
- 搬 3 個 system 檔(systemVersion → version、updater → update rename)
- 搬 1 個 services 檔(pipelineMerge)
- 原 path 全保留 barrel re-export(commit D 刪)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Commit C: rewrite 所有 caller 的 import path

策略:server/routes / cli / tests / server/lib 內部互引,全部從舊 path 改到新 path。每個檔內 import 一次改完,改完跑 build,綠了就下一檔。

### Task C1: server/routes/* 內 caller

**Files**(grep 出來的):
- `server/routes/projects.ts` 等所有 routes/* 內 `from "../lib/<old-path>"` 全改新

- [ ] **Step 1: 列出全部 routes 內舊 path import**

```bash
rg -n 'from ["\x27]\.\./lib/(atomicWrite|jsonl|fs|hash|paths|dialog|spawn|git|pipelineDir|projectStore|userConfig|auditLog|notifs/store|fcm/index|push/|systemVersion|updater|depInstall|pipelineMerge)' server/routes
```
記下命中清單

- [ ] **Step 2: 對照表 rewrite**

| 舊 import | 新 import |
|---|---|
| `"../lib/atomicWrite"` | `"../lib/io/atomicWrite"` |
| `"../lib/jsonl"` | `"../lib/io/jsonl"` |
| `"../lib/fs"` | `"../lib/io/fs"` |
| `"../lib/hash"` | `"../lib/io/hash"` |
| `"../lib/paths"` | `"../lib/io/paths"` |
| `"../lib/dialog"` | `"../lib/io/dialog"` |
| `"../lib/spawn"` | `"../lib/io/childSpawn"` |
| `"../lib/git"` | `"../lib/io/git"` |
| `"../lib/git/worktree"` | `"../lib/io/git/worktree"` |
| `"../lib/pipelineDir"` | 拆四個:`"../lib/domain/projectDir"` / `"../lib/domain/projectConfig"` / `"../lib/domain/pipeline"` / `"../lib/domain/mergeTicket"`(依 caller 用到的 export 對應拆,**沒用到的別 import**) |
| `"../lib/projectStore"` | `"../lib/domain/project"` |
| `"../lib/userConfig"` | `"../lib/domain/userConfig"` |
| `"../lib/auditLog"` | `"../lib/domain/auditLog"` |
| `"../lib/notifs/store"` | `"../lib/remote/notifs"` |
| `"../lib/fcm/index"` 或 `"../lib/fcm"` | `"../lib/remote/fcm"` |
| `"../lib/push/gatewayToken"` | `"../lib/remote/push/gatewayToken"` |
| `"../lib/push/tokenStore"` | `"../lib/remote/push/tokenStore"` |
| `"../lib/systemVersion"` | `"../lib/system/version"` |
| `"../lib/updater"` | `"../lib/system/update"` |
| `"../lib/depInstall"` | `"../lib/system/depInstall"` |
| `"../lib/pipelineMerge"` | `"../lib/services/pipelineMerge"` |

逐檔改。注意 `pipelineDir` 是拆三檔不是搬一檔:caller 若 import `{ readPipeline, writePipeline, ... }` → 從 `domain/pipeline` 拿;`{ readConfig, getResolvedDefaults }` → 從 `domain/projectConfig` 拿;`{ init, ensureRuntime, rootPath }` → 從 `domain/projectDir` 拿;`{ appendMergeTicket }` → 從 `domain/mergeTicket` 拿。

- [ ] **Step 3: tsc**

```bash
bun run build
```
Expected: 全綠

### Task C2: cli/* 內 caller

**Files**:
- `cli/vbpl.ts`
- `cli/commands/*.ts`(全部)
- `cli/lib/*.ts`(serverPath / project)

- [ ] **Step 1: 列出全部 cli 內舊 path import**

```bash
rg -n 'from ["\x27].*/server/lib/' cli
rg -n 'from ["\x27]\.\./.*lib/(atomicWrite|jsonl|fs|hash|paths|dialog|spawn|git|pipelineDir|projectStore|userConfig|auditLog|notifs/store|fcm/index|push/|systemVersion|updater|depInstall|pipelineMerge)' cli
```

- [ ] **Step 2: 套同對照表 rewrite**

(CLI 是相對路徑 `../../server/lib/...`,套同表,只是前綴不同。)

- [ ] **Step 3: tsc**

```bash
bun run build
```
Expected: 全綠

### Task C3: tests/* 內 caller

**Files**:
- `tests/codex-smoke/*.ts`
- `tests/e2e/*`(若有 import server/lib)

- [ ] **Step 1: 列出**

```bash
rg -n 'from ["\x27].*server/lib/' tests
```

- [ ] **Step 2: rewrite + tsc**

### Task C4: server/lib 內部互引(已不靠 barrel)

剩下還在用舊 path 互引的 server/lib 內檔。

- [ ] **Step 1: 列出**

```bash
rg -n 'from ["\x27]\.\./?(atomicWrite|jsonl|fs|hash|paths|dialog|spawn|git\.ts|pipelineDir|projectStore|userConfig|auditLog|notifs/store|fcm/index|push/|systemVersion|updater|depInstall|pipelineMerge)' server/lib --type ts
```
應該包含 `server/lib/runner/*` / `server/lib/qa/*` / `server/lib/cli/*` 等仍走舊 path 的檔。

- [ ] **Step 2: rewrite 對照表**

`runner/*` / `qa/*` / `cli/*` 內舊 `from "../pipelineDir"` 等全改成新 path(對照 Task C1 表,前綴 `../` 不變)。

- [ ] **Step 3: tsc + e2e**

```bash
bun run build && bun run test:e2e
```
Expected: 全綠

### Task C5: Commit C

- [ ] **Step 1: stage + commit**

```bash
git add server/routes cli tests server/lib
git status  # diff 應該全是 import path 變動,行為零變
git commit -m "refactor(server): rewrite 所有 caller 的 import path 到 server/lib 新分層

- server/routes/* / cli/* / tests/* / server/lib 內部互引全改
- 約 186 行 import 變動,零行為變動
- 舊 path barrel 仍在(commit D 刪)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Commit D: 刪 barrel + 空目錄

### Task D1: 刪 11 個 barrel re-export 檔 + 空目錄

**Files to delete**:
- `server/lib/atomicWrite.ts`
- `server/lib/jsonl.ts`
- `server/lib/fs.ts`
- `server/lib/hash.ts`
- `server/lib/paths.ts`
- `server/lib/dialog.ts`
- `server/lib/spawn.ts`
- `server/lib/git.ts`
- `server/lib/git/worktree.ts`(+ 整個 `server/lib/git/` 目錄)
- `server/lib/pipelineDir.ts`
- `server/lib/projectStore.ts`
- `server/lib/userConfig.ts`
- `server/lib/auditLog.ts`
- `server/lib/notifs/store.ts`(+ 整個 `server/lib/notifs/` 目錄)
- `server/lib/fcm/index.ts`(+ 整個 `server/lib/fcm/` 目錄)
- `server/lib/push/gatewayToken.ts`(+ 整個 `server/lib/push/` 目錄)
- `server/lib/push/tokenStore.ts`
- `server/lib/systemVersion.ts`
- `server/lib/updater.ts`
- `server/lib/depInstall.ts`
- `server/lib/pipelineMerge.ts`

- [ ] **Step 1: 刪檔**

```bash
rm server/lib/atomicWrite.ts \
   server/lib/jsonl.ts \
   server/lib/fs.ts \
   server/lib/hash.ts \
   server/lib/paths.ts \
   server/lib/dialog.ts \
   server/lib/spawn.ts \
   server/lib/git.ts \
   server/lib/pipelineDir.ts \
   server/lib/projectStore.ts \
   server/lib/userConfig.ts \
   server/lib/auditLog.ts \
   server/lib/systemVersion.ts \
   server/lib/updater.ts \
   server/lib/depInstall.ts \
   server/lib/pipelineMerge.ts
rm -rf server/lib/git server/lib/notifs server/lib/fcm server/lib/push
```

- [ ] **Step 2: grep regression**

```bash
rg 'from ["\x27].*lib/(atomicWrite|jsonl|fs|hash|paths|dialog|spawn|git\.ts|pipelineDir|projectStore|userConfig|auditLog|notifs/store|fcm/index|systemVersion|updater|depInstall|pipelineMerge)["\x27]' src server cli tests
```
Expected: 零命中

- [ ] **Step 3: tsc + e2e**

```bash
bun run build && bun run test:e2e
```
Expected: 全綠

- [ ] **Step 4: 手動 CLI sanity**

```bash
bun run cli/vbpl.ts project list
bun run cli/vbpl.ts config get
```
Expected: 兩個命令都跑得起來(import path 任何錯會 throw)

### Task D2: Commit D

- [ ] **Step 1: stage + commit**

```bash
git add -A server/lib
git status
git commit -m "refactor(server): 刪 server/lib 舊 path barrel re-exports

- 刪 16 個 barrel 檔 + 4 個空目錄(git/ notifs/ fcm/ push/)
- 從此 server/lib 只有新 layout(io/ domain/ remote/ system/ services/ runner/ qa/ cli/ + testMode.ts)
- grep regression 全零

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Commit E: 文件同步

### Task E1: 更新 `docs/refs/repo-structure.md`

**Files**:
- Modify: `docs/refs/repo-structure.md`(server/lib 段重寫)

- [ ] **Step 1: 找到 server/lib 段**

```bash
rg -n '^├── server/' docs/refs/repo-structure.md
```

- [ ] **Step 2: 改寫 server/lib 區塊**

把舊扁平樹改成新分層:
```
│   └── lib/                   純 IO + 邏輯,不知道 HTTP。五層分層:
│       ├── io/                  純 platform primitive(atomicWrite / jsonl / fs / hash / paths /
│       │                        dialog / childSpawn / git/{index,worktree})
│       ├── domain/              repo / project / pipeline / config 概念
│       │                        (project / userConfig / auditLog / projectDir / projectConfig /
│       │                         pipeline / mergeTicket)
│       ├── remote/              push 鏈(notifs / fcm / push/{gatewayToken,tokenStore})
│       ├── system/              VP 自己的元件(version / update / depInstall)
│       ├── services/            cross-domain 高階組合(pipelineMerge)
│       ├── runner/              (不動,既有結構)
│       ├── qa/                  (不動)
│       ├── cli/                 (不動)
│       └── testMode.ts          cross-cutting,被各 layer 讀
```

依賴方向 + 拆分理由節省版面,連到 design doc 即可:
> 五層分層 + `pipelineDir.ts` 拆 4 檔的完整設計見 [`2026-05-28-server-lib-restructure-design.md`](2026-05-28-server-lib-restructure-design.md)。

### Task E2: 更新 backend SKILL(若有具體 path)

**Files**:
- Check / modify: `.claude/skills/vibe-pipeline-backend/SKILL.md`

- [ ] **Step 1: grep 是否提到動到的舊 path**

```bash
rg -n '(pipelineDir|projectStore|notifs/store|fcm/index|systemVersion|updater|depInstall|pipelineMerge)' .claude/skills/vibe-pipeline-backend/SKILL.md
```

- [ ] **Step 2: 命中的全改新 path**

對照 plan 開頭 File Structure 區塊改。若無命中跳 Task E3。

### Task E3: 更新雷區 rule(若有具體 path)

**Files**:
- Check: `.claude/rules/*.md`(`cli-codex.md` 提到 `server/lib/cli/codexAdapter.ts`,沒搬,不必改)
- Check: `CLAUDE.md` 雷區 #6 等

- [ ] **Step 1: grep**

```bash
rg -n '(pipelineDir|projectStore|notifs/store|fcm/index|systemVersion|updater|depInstall|pipelineMerge)' CLAUDE.md .claude/rules
```

- [ ] **Step 2: 命中的改新 path**

### Task E4: Commit E

- [ ] **Step 1: stage + commit**

```bash
git add docs CLAUDE.md .claude
git status
git commit -m "docs(refactor): 文件同步 server/lib 新分層

- docs/refs/repo-structure.md server/lib 段重寫
- backend SKILL / CLAUDE.md / rules 內具體 path 引用對齊

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification

### Task F1: 全套驗證

- [ ] **Step 1: build + e2e 全跑**

```bash
bun run build
bun run test:e2e
```
Expected: 全綠,e2e 通過數 / 跑多久跟 Task 0 baseline 對得起來(±5% 內)

- [ ] **Step 2: CLI sanity**

```bash
bun run cli/vbpl.ts project list
bun run cli/vbpl.ts config get
bun run cli/vbpl.ts pipeline list
```
Expected: 三個都正常輸出

- [ ] **Step 3: grep regression 最終確認**

```bash
rg 'from ["\x27].*lib/(atomicWrite|jsonl|fs|hash|paths|dialog|spawn|git\.ts|pipelineDir|projectStore|userConfig|auditLog|notifs/store|fcm/index|systemVersion|updater|depInstall|pipelineMerge)["\x27]' src server cli tests
```
Expected: 零命中

- [ ] **Step 4: self-dogfood sub-agent worktree 驗(optional 但建議)**

開一個 dummy pipeline,跑一張 trivial ticket,確認 worktree 內 sub-agent 起 build 正常(import path 任何錯會立即 ENOENT)。

---

## Risks Recap(從 spec 抄入,實作時注意)

| 風險 | 對應 task |
|---|---|
| Barrel re-export 階段被誤認為「兩處都可寫」 | Commit D 刪 barrel + grep regression 防 |
| Windows path 大小寫(`git.ts` 跟 `git/` 並存) | Task B1 同 commit 內處理(`git.ts` 改 barrel `export * from "./io/git"`,實體 `git/worktree.ts` 也改 barrel),Commit D 整目錄刪 |
| `init()` 不再寫 config.json 漏改 caller | Task A6:全 grep `pipelineDir.init` 後對照只動一處 route handler(其他 caller 都是讀寫 config,不是 init) |
| 跨 provider sub-agent worktree import path 不同步 | Task F1 step 4 self-dogfood 驗 |

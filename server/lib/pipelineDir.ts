import { dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  statSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { currentBranch } from "./git";
import { appendStateChange } from "./auditLog";
import { atomicWriteJson } from "./atomicWrite";
import type { Pipeline } from "../../shared/types";

const DIR = ".vibe-pipeline";
// pipelines/*.json + .runtime/ 都是 runtime data,不該 commit;config.json 才 git tracked
const GITIGNORE_ENTRIES = [`${DIR}/.runtime/`, `${DIR}/pipelines/`];

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

// 已 fallback / 驗證過的完整 config defaults。GET / status 拿這個即可,不用每處再 ?? "main"。
export type ResolvedDefaults = {
  base_branch: string;
  max_parallel: number;
  cost_limit_usd: number;
  auto_merge: boolean;
};

export async function readConfig(projectPath: string): Promise<ProjectConfig> {
  const file = join(rootPath(projectPath), "config.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(await Bun.file(file).text());
  } catch {
    return {};
  }
}

export async function writeConfig(projectPath: string, cfg: ProjectConfig): Promise<void> {
  // 不只 mkdir root — 走 init() 一次補齊 pipelines/、.runtime/、gitignore、worktreeinclude。
  // 否則 PWA 改 config 會留下「只有 root + config.json,沒 pipelines/」的半 init 狀態,
  // 隨後 pipeline create 撞 ENOENT (.vibe-pipeline/pipelines/)。init 全 idempotent。
  await init(projectPath);
  await atomicWriteJson(join(rootPath(projectPath), "config.json"), cfg);
}

// max_parallel:讀 config + clamp [1,8],壞值 / 缺值 → DEFAULT_MAX_PARALLEL
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

// 拿 fallback 完整四欄。base_branch 沒設 → 嘗試 git current branch → 還沒就空字串(讓前端 placeholder)。
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

// idempotent:`.vibe-pipeline/` 已存在但內容缺(早期 partial init 失敗留的殘骸)→ 補齊;
// 全齊 → 也視為成功(no-op),不再 throw 'already_initialized'。
// 只在 path 存在但不是 dir(被檔案佔住等)時 throw
export async function init(projectPath: string): Promise<void> {
  const root = rootPath(projectPath);
  if (existsSync(root) && !statSync(root).isDirectory()) {
    throw new Error(".vibe-pipeline path is not a directory");
  }
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "pipelines"), { recursive: true });
  mkdirSync(join(root, ".runtime"), { recursive: true });

  const cfg = join(root, "config.json");
  if (!existsSync(cfg)) {
    await atomicWriteJson(cfg, DEFAULT_CONFIG);
  }
  for (const entry of GITIGNORE_ENTRIES) {
    await ensureGitignoreEntry(projectPath, entry);
  }
  await ensureWorktreeIncludeTemplate(projectPath);
}

// 開 worktree 時 git 只帶 tracked 檔,.env 等 gitignored 憑證不會進 worktree
// → AI 找不到會 hardcode。.worktreeinclude 列出要一起複製的 gitignored 檔(見 worktree.ts)。
// init 只放「全註解模板」:純 discoverability,VP 不猜這個 repo 該複製什麼。
// 已存在(含 Claude Code / user 自己寫的)→ 完全不碰。
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

const SLUG_CHARS = /[^a-z0-9-_]+/g;

export function generatePipelineId(name: string): string {
  const ts = Date.now().toString(16).padStart(12, "0");
  const slug = name.toLowerCase().replace(SLUG_CHARS, "-").replace(/^-+|-+$/g, "") || "pipeline";
  return `${ts}-${slug}`;
}

export async function listPipelines(projectPath: string): Promise<unknown[]> {
  const dir = join(rootPath(projectPath), "pipelines");
  if (!existsSync(dir)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const obj = JSON.parse(await Bun.file(join(dir, f)).text()) as Record<string, unknown>;
      // backfill createdAt:既有 pipeline 沒此欄位 → 用 id 內嵌的 hex timestamp(generatePipelineId 格式)
      if (typeof obj.createdAt !== "number") {
        const idStr = typeof obj.id === "string" ? obj.id : "";
        const tsHex = idStr.split("-")[0];
        const ts = tsHex && /^[0-9a-f]+$/i.test(tsHex) ? parseInt(tsHex, 16) : 0;
        obj.createdAt = Number.isFinite(ts) ? ts : 0;
      }
      out.push(obj);
    } catch {}
  }
  // 倒序排,UI 最新建的在最上面;舊資料 backfill 後也走同邏輯
  out.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
  return out;
}

export function pipelineFile(projectPath: string, id: string): string {
  return join(rootPath(projectPath), "pipelines", `${id}.json`);
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

// writePipeline 多 optional `opts`:
//   - source:audit log 內記「誰寫的」,沒傳 → 'unknown'。
//   - sourceDetail:同上,附帶上下文。
//   - prevStateHint:caller(mutatePipeline / 已讀過 disk 的 caller)把舊 state 傳進來,
//                   避免再讀一次。沒傳就自己讀 disk 拿舊 state。
// 寫入後若 prev.state !== next.state → appendStateChange。
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
  // defensive: 若 caller 跳過 init / writeConfig 走野生路徑(理論上不該,但歷史踩過),
  // 確保 pipelines/ 存在再寫,避免 writeFile ENOENT。
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

// pipeline.json read-modify-write 的 race-safe helper:read → 同步 mutator → write,
// **中間零 await**。pipeline.json 是 user PUT + runner / route handler 多處同時寫的共享狀態,
// 任何「讀 snapshot → await 慢操作 → 寫回 snapshot」pattern 都會吃掉中間 user 改的欄位。
//
// 紀律:
//   - mutator 必須宣告 sync ((p: Pipeline) => Pipeline),不接受 async / Promise。
//   - 任何慢操作(git / spawn / fetch / 其他 fs)寫在 helper **外面**,callsite 自己處理。
//   - mutator 內只做純資料轉換(set status / push ticket / 改 iter 計數等)。
//
// 為何不接受 async mutator:async function 即便 body 沒 await,return type 仍是 Promise,
// 強制 await 等於恢復 race window。寫死 sync 簽名是讓「中間插 await」變成型別錯誤,
// 後人改錯時 tsc 就會擋下(防呆 by type system)。
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

// Append 一張 synthetic merge ticket 到 pipeline 末尾,用來給 runner 派 sub-agent 處理 AI 合併。
// 已有失敗 / paused 的 merge ticket → reset 它(status=ready、清 iter),不重複 append。
// 失敗條件:沒 pipeline / 還有 real ticket 沒 done / 已 merged / 已有 running/done 的 merge ticket。
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
    // failed_iter_limit / failed / failed_transient / paused → reset 它,prompt 重灌(萬一 strategy 改了)
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
    _synthetic: true, // user 不可改 / 不可刪;runner 完成後 set state=merged
  };
  tickets.push(ticket);
  await writePipeline(projectPath, pipelineId, { ...p, tickets }, {
    source: "appendMergeTicket",
    sourceDetail: "append new merge ticket",
    prevStateHint: typeof p.state === "string" ? p.state : undefined,
  });
  return { ok: true, ticket, reused: false };
}

// 刪 pipeline.json(worktree 不動,user 想清自己去)
export function deletePipeline(projectPath: string, id: string): boolean {
  const file = pipelineFile(projectPath, id);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

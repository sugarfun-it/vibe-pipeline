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

// 已 fallback / 驗證過的完整 config defaults。GET / status 拿這個即可,不用每處再 ?? "main"。
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
// 沒帶 cfg 時:沒檔才寫 DEFAULT_CONFIG(取代舊 init 內寫 default 的行為),有檔不覆寫。
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

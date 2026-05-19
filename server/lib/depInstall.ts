// Merge 後若 package.json deps 或 bun.lock 動到 → 跑 `bun install` 同步 main repo node_modules。
// 純機械:git diff key 比對 → spawn bun install。不碰 AI。
// 雷區 #20:self-dogfood pipeline 加新 dep 後 main repo node_modules 不同步會撞「Cannot find package」。

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runCapture } from "./spawn";

export type DepInstallResult =
  | { ran: false; reason: "no_dep_change" }
  | { ran: true; ok: true; durationMs: number }
  | { ran: true; ok: false; error: string; durationMs: number };

const DEP_KEYS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

async function readJsonAtCommit(projectPath: string, commit: string, file: string): Promise<Record<string, unknown> | null> {
  const r = await runCapture(["git", "show", `${commit}:${file}`], { cwd: projectPath });
  if (!r.ok) return null;
  try { return JSON.parse(r.out); } catch { return null; }
}

function depsChanged(before: Record<string, unknown> | null, after: Record<string, unknown> | null): boolean {
  if (!before && !after) return false;
  if (!before || !after) return true;
  for (const k of DEP_KEYS) {
    const b = JSON.stringify(before[k] ?? {});
    const a = JSON.stringify(after[k] ?? {});
    if (b !== a) return true;
  }
  return false;
}

async function fileChangedInCommit(projectPath: string, commit: string, file: string): Promise<boolean> {
  // merge commit 第一 parent 是 base 前一個 HEAD;diff 對它看這檔有沒有變
  const r = await runCapture(["git", "diff", "--name-only", `${commit}^1`, commit, "--", file], { cwd: projectPath });
  return r.ok && r.out.trim().length > 0;
}

// 判 merge commit 是否影響 deps,影響就跑 bun install 同步 main 的 node_modules。
// 若 package.json 不存在(非 bun/npm project)直接 skip。
export async function ensureDepsAfterMerge(projectPath: string, mergeCommit: string): Promise<DepInstallResult> {
  // 1. 確認是 node project
  try {
    await readFile(join(projectPath, "package.json"), "utf-8");
  } catch {
    return { ran: false, reason: "no_dep_change" };
  }

  // 2. 看 merge 是否動到 package.json 或 bun.lock
  const pkgChanged = await fileChangedInCommit(projectPath, mergeCommit, "package.json");
  const lockChanged = await fileChangedInCommit(projectPath, mergeCommit, "bun.lock");

  if (!pkgChanged && !lockChanged) return { ran: false, reason: "no_dep_change" };

  // 3. package.json 變了 → 細看是否動到 deps keys(避免 description / scripts 改動觸發)
  // bun.lock 變了一律當 dep 變(transitive update)
  if (pkgChanged && !lockChanged) {
    const before = await readJsonAtCommit(projectPath, `${mergeCommit}^1`, "package.json");
    const after = await readJsonAtCommit(projectPath, mergeCommit, "package.json");
    if (!depsChanged(before, after)) return { ran: false, reason: "no_dep_change" };
  }

  // 4. 跑 bun install
  const t0 = Date.now();
  const r = await runCapture(["bun", "install"], { cwd: projectPath });
  const durationMs = Date.now() - t0;
  if (!r.ok) {
    return { ran: true, ok: false, error: (r.err || r.out).trim().split(/\r?\n/).slice(-5).join("\n"), durationMs };
  }
  return { ran: true, ok: true, durationMs };
}

// Real-mode 專用 helper(不用 mock control endpoints)。

import { spawnSync } from "node:child_process";

export const VP_AUTOTEST_PATH = "d:/sugarfungit/vp-autotest";
export const VP_AUTOTEST_HASH = "cf94d1b2";
export const API = "http://127.0.0.1:3001/api";

// 用 Real 模式跑 spec 之前確認 backend 在 real 模式(testMode=false),不然劇本機會跑進 mock。
export async function assertRealMode(): Promise<void> {
  const res = await fetch(`${API}/health`);
  const body = (await res.json()) as { data?: { testMode?: boolean } };
  if (body.data?.testMode === true) {
    throw new Error(
      "[real] backend 在 mock 模式 — 別把 mock-mode bun 留著跑 real 套(殺 3001 重啟)"
    );
  }
}

// 列 vp-autotest 既有 pipelines。
export async function listAutotestPipelines(): Promise<Array<{ id: string; state?: string }>> {
  const res = await fetch(`${API}/projects/${VP_AUTOTEST_HASH}/pipelines`);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: Array<{ id: string; state?: string }> };
  return body.data ?? [];
}

// 砍 vp-autotest 上的某條 pipeline(JSON + worktree 留 user 自己 reveal)。
export async function deleteAutotestPipeline(id: string): Promise<void> {
  await fetch(`${API}/projects/${VP_AUTOTEST_HASH}/pipelines/${id}`, { method: "DELETE" });
}

// 在 vp-autotest 直接 spawn git(不經 backend),preflight / cleanup 時用。
export function autotestGit(args: string[]): { ok: boolean; out: string; err: string } {
  const res = spawnSync("git", args, {
    cwd: VP_AUTOTEST_PATH,
    encoding: "utf-8",
  });
  return { ok: res.status === 0, out: res.stdout ?? "", err: res.stderr ?? "" };
}

// 在 vp-autotest 確保開在 main + 沒髒。
export function ensureCleanMain(): void {
  autotestGit(["checkout", "main"]);
  autotestGit(["reset", "--hard", "HEAD"]);
}

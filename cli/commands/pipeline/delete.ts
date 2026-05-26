import * as pipelineDir from "../../../server/lib/pipelineDir";
import { resolveProject, requireInit } from "../../lib/project";
import { ensureBackend } from "../../lib/ensureBackend";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print, printLines } from "../../lib/output";
import type { Pipeline } from "../../../shared/types";

async function confirmTty(question: string): Promise<boolean> {
  // 沒 TTY 時無法問 → 視為「未確認」by caller(預設 fail)。
  if (!process.stdin.isTTY) return false;
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(question)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

// Delete cascade:走 backend HTTP — backend 負責 preflight(reject running/queued)+ worktree + branch + json + notif。
// CLI 只管 confirm prompt 與 partial result 顯示。
//   --force      跳過 confirm
//   --json mode  自動當 --force(無法互動)
export async function pipelineDelete(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline delete <id> [--force]");

  const force = args.flags["force"] === true || isJsonMode();

  // 先撈 pipeline 確認存在(讓 confirm 訊息可以顯示 name + branch)
  const pipeline = (await pipelineDir.readPipeline(proj.path, id)) as Pipeline | null;
  if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${id}`);

  if (!force) {
    const branchInfo = pipeline!.branch ? ` + branch ${pipeline!.branch}` : "";
    const confirmed = await confirmTty(
      `真要刪 pipeline ${pipeline!.name} [${id}] (含 worktree${branchInfo} + pipeline.json)? y/n: `
    );
    if (!confirmed) {
      fail("USER_CANCELLED", "Delete cancelled.");
    }
  }

  await ensureBackend();
  type DeleteResp = {
    ok: true;
    partial: boolean;
    steps: {
      worktree: { ok: boolean; error?: string; skipped?: boolean };
      branch: { ok: boolean; error?: string; skipped?: boolean };
      json: { ok: boolean; error?: string; skipped?: boolean };
    };
    message?: string;
  };
  // 走 fetch DELETE — cli/lib/api.ts 只有 post(),這邊 inline 一個 DELETE
  // (ensureBackend 已在上面跑過)
  const res = await fetchDelete<DeleteResp>(`/api/projects/${proj.hash}/pipelines/${id}`);

  if (isJsonMode()) {
    okJson({ deleted: true, id, partial: res.partial, steps: res.steps, message: res.message });
    return;
  }
  if (res.partial) {
    printLines([
      `⚠ Pipeline 部分刪除:${pipeline!.name} [${id}]`,
      `  worktree: ${stepLine(res.steps.worktree)}`,
      `  branch:   ${stepLine(res.steps.branch)}`,
      `  json:     ${stepLine(res.steps.json)}`,
    ]);
    if (res.message) print(`  → ${res.message}`);
  } else {
    print(`✓ Deleted pipeline: ${pipeline!.name} [${id}] (worktree + branch + json 已清)`);
  }
}

function stepLine(s: { ok: boolean; error?: string; skipped?: boolean }): string {
  if (s.skipped) return "skipped" + (s.error ? ` (${s.error})` : "");
  if (s.ok) return "ok";
  return `FAIL — ${s.error ?? "(no message)"}`;
}

async function fetchDelete<T = unknown>(path: string): Promise<T> {
  const { apiBase } = await import("../../lib/serverBase");
  const url = `${apiBase()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "DELETE" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("IO_ERROR", `DELETE ${path} 連線失敗:${msg}`);
  }
  const j = (await res.json()) as { ok: true; data: T } | { ok: false; error: { code?: string; message: string } };
  if (!j.ok) {
    const code = j.error?.code?.toUpperCase() || "IO_ERROR";
    fail(code, j.error?.message || `${path} 失敗(${res.status})`);
  }
  return j.data;
}

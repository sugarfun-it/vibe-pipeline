// Synthetic merge ticket(_synthetic: true,user 不可改 / 不可刪)。
// Append 一張到 pipeline 末尾,用來給 runner 派 sub-agent 處理 AI 合併。
// 已有失敗 / paused 的 merge ticket → reset 它(status=ready、清 iter),不重複 append。
// 失敗條件:沒 pipeline / 還有 real ticket 沒 done / 已 merged / 已有 running/done 的 merge ticket。

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

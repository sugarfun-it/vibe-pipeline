import type { WriteStream } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { readPipeline, writePipeline } from "../../domain/pipeline";
import * as runLog from "../runLog";

const LOG_CODE_WIDTH = 10;

// P5: 抓 ticket id/status 寫進 log meta block,RunHistory diff 用
export function snapshotTickets(
  tickets: ReadonlyArray<{ id?: string; status?: string } | undefined> | undefined
): Array<{ id: string; status: string }> {
  if (!tickets) return [];
  const out: Array<{ id: string; status: string }> = [];
  for (const t of tickets) {
    if (t && typeof t.id === "string" && typeof t.status === "string") {
      out.push({ id: t.id, status: t.status });
    }
  }
  return out;
}

export function runnerLogHeader(pipelineId: string, state: "active" | "exited", code: number | null = null): string {
  const codeText = code == null ? "".padEnd(LOG_CODE_WIDTH) : String(code).padEnd(LOG_CODE_WIDTH);
  return `[runner ${pipelineId}] ${state} code=${codeText}\n`;
}

export function endStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => stream.end(resolve));
}

export async function patchRunnerLogExitCode(logFile: string, pipelineId: string, code: number | null): Promise<void> {
  const file = await openFile(logFile, "r+");
  try {
    await file.write(runnerLogHeader(pipelineId, "exited", code), 0, "utf8");
  } finally {
    await file.close();
  }
}

const LEGACY_PAUSE_PENDING_STATE = "stop" + "ping";

export function isLegacyPausePendingState(state: unknown): boolean {
  return state === LEGACY_PAUSE_PENDING_STATE;
}

// 算單一 pipeline 的累積花費。
// 來源優先序:ticket.runs[].cost(若 runner 有寫入)→ fallback 解析 runtime/logs/<pipelineId>-<ts>.log。
// 已 merged / failed / paused 也算。算不出來就當 0,絕不擋住 /run。
export async function computePipelineSpent(projectPath: string, pipelineId: string): Promise<number> {
  try {
    const pipeline = (await readPipeline(projectPath, pipelineId)) as {
      tickets?: Array<{
        runs?: Array<{ cost?: number }>;
        [k: string]: unknown;
      }>;
      [k: string]: unknown;
    } | null;
    if (!pipeline) return 0;

    let total = 0;
    let foundTicketCost = false;
    for (const t of pipeline.tickets ?? []) {
      for (const r of t.runs ?? []) {
        if (typeof r.cost === "number" && Number.isFinite(r.cost)) {
          total += r.cost;
          foundTicketCost = true;
        }
      }
    }
    if (foundTicketCost) return total;

    // fallback:沒 ticket-level cost,sum 該 pipeline 的 log 解析結果
    try {
      const runs = await runLog.listRuns(projectPath, pipelineId);
      for (const r of runs) {
        if (typeof r.costUsd === "number" && Number.isFinite(r.costUsd)) {
          total += r.costUsd;
        }
      }
    } catch {
      // log 解析失敗當 0
    }
    return total;
  } catch {
    return 0;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 讀 pipeline → 找對應 ticket → 套 update fn → 寫回。每次都全 reload 因 user 可能中途改別欄。
export async function mutateTicket(
  projectPath: string,
  pipelineId: string,
  ticketId: string,
  update: (t: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const p = (await readPipeline(projectPath, pipelineId)) as {
    tickets?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  } | null;
  if (!p) return;
  const tickets = p.tickets ?? [];
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return;
  tickets[idx] = update(tickets[idx]);
  const prev = typeof (p as { state?: unknown }).state === "string"
    ? ((p as { state: string }).state)
    : undefined;
  await writePipeline(projectPath, pipelineId, { ...p, tickets }, {
    source: "mock-runner-ticket",
    sourceDetail: `update ticket ${ticketId}`,
    prevStateHint: prev,
  });
}

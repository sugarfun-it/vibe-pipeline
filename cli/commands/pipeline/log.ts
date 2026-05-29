import * as runLog from "../../../server/lib/runner/runLog";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print, printLines } from "../../lib/output";
import { tailFollow } from "../../lib/tailFollow";
import type { RunSummary } from "../../../shared/types";

export async function pipelineLog(args: ParsedArgs): Promise<void> {
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline log <id> [--last N] [--follow|-f]");

  const follow = args.flags["follow"] === true || args.flags["f"] === true;
  if (follow && isJsonMode()) {
    fail("INVALID_ARGS", "--json mode does not support --follow. Use --json with the listRuns API and manage streaming yourself.");
  }

  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  if (follow) {
    await followPipelineLog(proj.path, id);
    return;
  }

  const lastN = typeof args.flags["last"] === "string" ? Number(args.flags["last"]) : 1;
  const runs = await runLog.listRuns(proj.path, id);

  if (isJsonMode()) {
    okJson(runs.slice(0, lastN));
    return;
  }
  if (runs.length === 0) {
    print("No run logs found.");
    return;
  }
  const toShow = runs.slice(0, lastN);
  for (const run of toShow) {
    printLines([
      `--- Run ${run.filename} ---`,
      `started:  ${new Date(run.startedAt).toLocaleString()}`,
      `exit:     ${run.exitCode ?? "?"}`,
      `duration: ${run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "-"}`,
      `cost:     ${run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : "-"}`,
      `turns:    ${run.numTurns ?? "-"}`,
      `result:   ${run.result ? run.result.slice(0, 200) : "-"}`,
    ]);
    print("");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitLatestRun(projectPath: string, pipelineId: string): Promise<RunSummary> {
  while (true) {
    const runs = await runLog.listRuns(projectPath, pipelineId);
    if (runs[0]?.logPath) return runs[0];
    await sleep(500);
  }
}

async function followPipelineLog(projectPath: string, pipelineId: string): Promise<void> {
  let logPath = "";
  await tailFollow({
    resolveLogPath: async () => {
      const latest = await waitLatestRun(projectPath, pipelineId);
      logPath = latest.logPath;
      return logPath;
    },
    errorPrefix: "log follow stopped",
    // run 重 spawn → 換成新 logPath:結束 follow 提示 re-run(同檔被截斷由 tailFollow 自動重讀)
    poll: {
      intervalMs: 500,
      check: async () => {
        const runs = await runLog.listRuns(projectPath, pipelineId);
        if (runs[0]?.logPath && runs[0].logPath !== logPath) {
          return { stop: true, message: "pipeline 重 spawn,請 re-run vbpl pipeline log --follow" };
        }
        return null;
      },
    },
  });
}

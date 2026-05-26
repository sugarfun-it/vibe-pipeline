import { watch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import * as runLog from "../../../server/lib/runner/runLog";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print, printLines } from "../../lib/output";
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
  let logPath: string | null = null;
  let lastSize = 0;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let rotationPoll: ReturnType<typeof setInterval> | null = null;
  let reading = false;
  let pending = false;
  let done = false;
  let finish: (() => void) | null = null;

  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (debounce) clearTimeout(debounce);
    if (rotationPoll) clearInterval(rotationPoll);
    watcher?.close();
    process.off("SIGINT", onSigint);
  };
  const complete = (): void => {
    cleanup();
    finish?.();
  };
  const onSigint = (): void => {
    cleanup();
    process.exit(0);
  };
  const readIncremental = async (): Promise<void> => {
    if (!logPath) return;
    const info = await stat(logPath);
    if (info.size <= lastSize) return;
    const file = await open(logPath, "r");
    try {
      let remaining = info.size - lastSize;
      let position = lastSize;
      const buffer = Buffer.alloc(Math.min(64 * 1024, remaining));
      while (remaining > 0) {
        const toRead = Math.min(buffer.length, remaining);
        const { bytesRead } = await file.read(buffer, 0, toRead, position);
        if (bytesRead === 0) break;
        process.stdout.write(buffer.subarray(0, bytesRead));
        position += bytesRead;
        remaining -= bytesRead;
      }
      lastSize = position;
    } finally {
      await file.close();
    }
  };
  const drain = async (): Promise<void> => {
    if (reading) {
      pending = true;
      return;
    }
    reading = true;
    try {
      do {
        pending = false;
        await readIncremental();
      } while (pending);
    } catch (e) {
      process.stderr.write(`log follow stopped: ${e instanceof Error ? e.message : String(e)}\n`);
      complete();
    } finally {
      reading = false;
    }
  };
  const scheduleRead = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void drain();
    }, 100);
  };

  process.on("SIGINT", onSigint);
  const latest = await waitLatestRun(projectPath, pipelineId);
  logPath = latest.logPath;
  watcher = watch(logPath, scheduleRead);
  await drain();

  rotationPoll = setInterval(() => {
    void (async () => {
      const runs = await runLog.listRuns(projectPath, pipelineId);
      if (runs[0]?.logPath && runs[0].logPath !== logPath) {
        process.stderr.write("pipeline 重 spawn,請 re-run vbpl pipeline log --follow\n");
        complete();
      }
    })();
  }, 500);

  await new Promise<void>((resolve) => {
    finish = resolve;
  });
}

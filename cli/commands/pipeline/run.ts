import * as pipelineStore from "../../../server/lib/domain/pipeline";
import { resolveProject, requireInit } from "../../lib/project";
import { ensureBackend } from "../../lib/ensureBackend";
import { post } from "../../lib/api";
import type { ParsedArgs } from "../../lib/args";
import { bool } from "../../lib/args";
import { fail, isJsonMode, okJson, print } from "../../lib/output";
import type { Pipeline } from "../../../shared/types";

// 走 backend HTTP — spawn child(claude/codex runner)必須讓 backend 養。
// CLI 自己 spawn 會在 CLI 退出時失去 child 控制權(orchestrator running map 蒸發,watchdog / stop 都失效)
export async function pipelineRun(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline run <id> [--wait] [--timeout <sec>] [--poll <sec>]");
  await ensureBackend();

  const wait = bool(args.flags["wait"]);

  // --wait 對「已有 runner 在跑 / 排隊中」的 pipeline:不重觸發 run(會被 backend state guard
  // 擋成「已在 running」直接 fail),改成直接等它到終態 =「這條已在跑,我就等它」。
  // 雷:planning 不算「已在進行」— 它是「建好但還沒啟動」,必須 fall through 去 POST /run,
  // 否則 --wait 會卡在 planning 永遠等不到終態(runner 從沒被啟動)。踩過。
  if (wait) {
    const existing = (await pipelineStore.readPipeline(proj.path, id)) as Pipeline | null;
    if (existing && ALREADY_ACTIVE.has(existing.state)) {
      if (!isJsonMode()) print(`Pipeline already ${existing.state}, waiting for terminal: ${id}`);
      await waitForTerminal(proj.path, id, args.flags);
      return;
    }
  }

  const result = await post<{ ok: true; queued?: boolean; position?: number | null }>(
    `/api/projects/${proj.hash}/pipelines/${id}/run`
  );

  if (!wait) {
    if (isJsonMode()) {
      okJson({ started: true, pipelineId: id, queued: result.queued ?? false, position: result.position ?? null });
      return;
    }
    if (result.queued) {
      print(`Pipeline queued: ${id} (position ${result.position ?? "?"})`);
    } else {
      print(`Pipeline started: ${id}`);
    }
    return;
  }

  await waitForTerminal(proj.path, id, args.flags);
}

// 進行中(continue polling);其餘視為終態回應。planning 含在內:POST /run 後
// planning→running 過渡期還要繼續 poll,不能當終態。
const PROGRESSING = new Set<string>(["planning", "running", "queued", "stopping"]);

// 「已有 runner 在跑 / 排隊中」— 重觸發 run 會被 backend guard 擋,--wait 直接等終態即可。
// 刻意不含 planning:planning 需要被 /run 啟動(否則 --wait 卡死在 planning,runner 從沒啟動)。
const ALREADY_ACTIVE = new Set<string>(["running", "queued", "stopping"]);

// 終態 → exit code 約定,讓 batch / 別的 AI 用 exit code 直接分支
const EXIT_CODE: Record<string, number> = {
  ready: 0,
  merged: 0,
  paused: 2,
  failed: 3,
};

async function waitForTerminal(
  projectPath: string,
  id: string,
  flags: ParsedArgs["flags"]
): Promise<void> {
  const pollSec = numFlag(flags["poll"], 10);
  // timeout 0 = 無限等;預設 2h 防 backend 卡死 / pipeline 永遠 paused 時 caller 無限掛
  const timeoutSec = numFlag(flags["timeout"], 7200);
  const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : Infinity;

  for (;;) {
    const pipeline = (await pipelineStore.readPipeline(projectPath, id)) as Pipeline | null;
    if (!pipeline) fail("NO_PIPELINE", `Pipeline not found: ${id}`);
    const state = pipeline!.state;

    if (!PROGRESSING.has(state)) {
      const code = EXIT_CODE[state] ?? 1;
      const tickets = (pipeline!.tickets ?? []).map((t) => ({ n: t.n, title: t.title, status: t.status }));
      if (isJsonMode()) {
        process.stdout.write(JSON.stringify({ ok: code === 0, data: { pipelineId: id, state, tickets } }) + "\n");
      } else {
        print(`Pipeline ${state}: ${id}`);
        for (const t of tickets) print(`  [${t.status}] #${t.n} ${t.title}`);
      }
      process.exit(code);
    }

    if (Date.now() >= deadline) {
      if (isJsonMode()) {
        process.stdout.write(JSON.stringify({ ok: false, data: { pipelineId: id, state, timedOut: true } }) + "\n");
      } else {
        print(`Timeout after ${timeoutSec}s, still ${state}: ${id}`);
      }
      process.exit(124);
    }

    await sleep(pollSec * 1000);
  }
}

function numFlag(v: string | boolean | undefined, dflt: number): number {
  if (typeof v !== "string") return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

import { readPipeline, writePipeline } from "../../domain/pipeline";
import * as notifs from "../../remote/notifs";
import * as ticketWatcher from "../ticketWatcher";
import { dispatch } from "./queue";
import { clearRunnerPid, readRunnerPid, verifyRunnerPid } from "./runnerPidFile";
import { key, running } from "./state";
import { killProcessTree } from "./watchdog";

// Immediate stop:對 spawn 的主 agent ChildProcess SIGKILL(Windows ChildProcess.kill() = terminate),
// 然後同步把 pipeline.state = "paused" + 把仍 running 的 ticket 標 "paused"。
// 已死 process / 找不到 handle → 視同成功,只校正 pipeline.json 狀態。
// state guard:pipeline 不在 running 才報 state_guard。
export async function stopImmediate(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string; code?: "state_guard" | "not_found" }> {
  const { projectPath, projectHash, pipelineId } = opts;
  const k = key(projectHash, pipelineId);

  const pipeline = (await readPipeline(projectPath, pipelineId)) as {
    state?: string;
    tickets?: Array<{ status?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  } | null;
  if (!pipeline) {
    return { ok: false, error: `Pipeline not found: ${pipelineId}`, code: "not_found" };
  }
  if (pipeline.state !== "running") {
    return {
      ok: false,
      error: `Pipeline 不在 running 狀態(當前: ${pipeline.state})`,
      code: "state_guard",
    };
  }

  // 砍整棵 process tree(main agent + sub-agent + sub-agent 子孫)。Windows 單殺
  // 父不殺孫,SIGKILL main agent 會留 codex/claude sub-agent orphan(用 fs 看到 ticket
  // 被改但不知誰幹的)。改走 killProcessTree:Windows taskkill /T,POSIX process group。
  const entry = running.get(k);
  if (entry?.proc) {
    try {
      await killProcessTree(entry.proc.pid);
    } catch (e) {
      console.warn(`[runner ${pipelineId}] killProcessTree failed (likely already exited):`, e);
    }
    // 等 exit 確認 — proc.exited 在已死的 process 上會立刻 resolve
    try {
      await Promise.race([
        entry.proc.exited,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // ignore
    }
  }

  // 兜底:in-memory entry 不見(watchdog 誤判 recover / duplicate spawn 後舊 runner 變
  // orphan)時,map 那條殺不到真正活著的 orphan。讀 sidecar pid,若還活就 killProcessTree。
  // entry 存在且 pid 相同 → 上面已殺,這裡 isPidAlive 多半 false 直接跳過。
  const sidecar = readRunnerPid(projectPath, pipelineId);
  if (sidecar && sidecar.pid !== entry?.proc?.pid && (await verifyRunnerPid(sidecar))) {
    console.warn(`[runner ${pipelineId}] stop: killing orphan runner pid=${sidecar.pid} (not tracked in map)`);
    try {
      await killProcessTree(sidecar.pid);
    } catch (e) {
      console.warn(`[runner ${pipelineId}] stop orphan kill failed:`, e);
    }
  }

  // 確保 in-memory entry 清掉(exit handler 通常也會清,但我們已經 SIGKILL,搶在前面或補)
  running.delete(k);
  clearRunnerPid(projectPath, pipelineId);
  ticketWatcher.stop({ projectHash, pipelineId });

  // 重讀 pipeline(exit handler 可能已寫一輪)→ 校正狀態
  const cur = (await readPipeline(projectPath, pipelineId)) as {
    state?: string;
    name?: string;
    tickets?: Array<{ status?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  } | null;
  if (cur) {
    const tickets = (cur.tickets ?? []).map((t) =>
      t.status === "running" ? { ...t, status: "paused" } : t
    );
    await writePipeline(projectPath, pipelineId, {
      ...cur,
      state: "paused",
      tickets,
    }, {
      source: "stop-immediate",
      sourceDetail: "user pressed stop",
      prevStateHint: typeof cur.state === "string" ? cur.state : undefined,
    });
    notifs.emit(projectPath, {
      type: "pipeline_paused",
      title: `${cur.name || pipelineId} 已立即停止`,
      sub: "主 agent 被強制終止",
      pipelineId,
    });
  }

  // slot 釋出,queue 接棒
  dispatch(projectPath, projectHash).catch((e) =>
    console.error(`[runner ${pipelineId}] dispatch after immediate stop failed:`, e)
  );

  return { ok: true };
}

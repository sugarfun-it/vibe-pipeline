import { readPipeline, writePipeline } from "../../domain/pipeline";
import { getMaxParallel } from "../../domain/projectConfig";
import { spawnDirect } from "./spawn";
import { queues, type QueuedItem, runningCount } from "./state";

export function enqueue(item: QueuedItem): void {
  const arr = queues.get(item.projectHash) ?? [];
  arr.push(item);
  queues.set(item.projectHash, arr);
}

export function dequeue(projectHash: string, pipelineId: string): boolean {
  const arr = queues.get(projectHash);
  if (!arr) return false;
  const i = arr.findIndex((it) => it.pipelineId === pipelineId);
  if (i < 0) return false;
  arr.splice(i, 1);
  if (arr.length === 0) queues.delete(projectHash);
  return true;
}

// 從 queue 撈下一張可跑的並 spawn。每次 ticket 跑完 / max_parallel 變動時呼叫。
// 每次只取 1 張(if slot 還空就會被下一輪 dispatch 接著跑)。
export async function dispatch(projectPath: string, projectHash: string): Promise<void> {
  const max = await getMaxParallel(projectPath);
  while (runningCount(projectHash) < max) {
    const arr = queues.get(projectHash);
    if (!arr || arr.length === 0) return;
    const next = arr.shift()!;
    if (arr.length === 0) queues.delete(projectHash);

    // 嘗試 spawn — 若目標 pipeline 已不在 queued 狀態(被 user 改回 paused / 刪掉)就跳過
    const cur = (await readPipeline(projectPath, next.pipelineId)) as {
      state?: string;
    } | null;
    if (!cur || cur.state !== "queued") continue;
    // 改回 ready / paused 之類後再 spawn(spawn 內會 mark running)
    // 但內部 spawn 已 own state guard;這邊不重設 state,直接呼叫內部 spawn
    await spawnDirect({ projectPath, projectHash, pipelineId: next.pipelineId });
  }
}

// 把已 queued 的 pipeline 從 queue 移除 + state 回 paused。給 user 在排隊時按「取消排隊」用。
export async function cancelQueued(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectPath, projectHash, pipelineId } = opts;
  const removed = dequeue(projectHash, pipelineId);
  if (!removed) return { ok: false, error: "Pipeline 不在排隊中" };
  const pipeline = (await readPipeline(projectPath, pipelineId)) as {
    state?: string;
    [k: string]: unknown;
  } | null;
  if (pipeline && pipeline.state === "queued") {
    await writePipeline(projectPath, pipelineId, {
      ...pipeline,
      state: "paused",
    }, {
      source: "cancel-queued",
      sourceDetail: "user dequeue",
      prevStateHint: pipeline.state,
    });
  }
  return { ok: true };
}

// 公開給 routes:max_parallel 變大時手動觸發補位
export async function triggerDispatch(projectPath: string, projectHash: string): Promise<void> {
  await dispatch(projectPath, projectHash);
}

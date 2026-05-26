export type RunningProcess = {
  pipelineId: string;
  proc: Bun.Subprocess | null; // mock 模式為 null
  startedAt: number;
  // kind 區分 ticket runner 主 agent 跟 sync AI(衝突解)。
  // isRunning() / runningCount() 都把兩種視為 busy,擋 /run /merge /sync 等操作。
  // 但 watchdog crash recovery 行為不同:ticket 標 paused;sync 走 git merge --abort + syncJob.state="failed"
  kind: "ticket" | "sync";
};

export const running = new Map<string, RunningProcess>(); // key: <projectHash>:<pipelineId>

export let watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function setWatchdogTimer(timer: ReturnType<typeof setInterval> | null): void {
  watchdogTimer = timer;
}

// FIFO queue per project:enqueue 順序 = 排隊順位。dispatcher 從隊頭撈、轉 spawn。
// 不存 process,只存「下一次 spawn 該帶的 opts」。
export type QueuedItem = {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
  enqueuedAt: number;
};
// key: projectHash → ordered list (順位 = index + 1)
export const queues = new Map<string, QueuedItem[]>();

export function key(projectHash: string, pipelineId: string): string {
  return `${projectHash}:${pipelineId}`;
}

// 暴露給 syncJob.ts 註冊 / 卸載 sync 的 running entry。
// 共用 running map 讓 isRunning() / runningCount() / max_parallel 自動把 sync 算成 busy。
export function registerSyncRunning(
  projectHash: string,
  pipelineId: string,
  proc: Bun.Subprocess
): void {
  running.set(key(projectHash, pipelineId), {
    pipelineId,
    proc,
    startedAt: Date.now(),
    kind: "sync",
  });
}

export function unregisterRunning(projectHash: string, pipelineId: string): void {
  running.delete(key(projectHash, pipelineId));
}

export function runningKind(
  projectHash: string,
  pipelineId: string
): "ticket" | "sync" | null {
  return running.get(key(projectHash, pipelineId))?.kind ?? null;
}

export function isRunning(projectHash: string, pipelineId: string): boolean {
  return running.has(key(projectHash, pipelineId));
}

export function isQueued(projectHash: string, pipelineId: string): boolean {
  const q = queues.get(projectHash);
  return q ? q.some((it) => it.pipelineId === pipelineId) : false;
}

// 同 project 還在跑的條數 — 給 routes / TopBar N/M 用
export function runningCount(projectHash: string): number {
  let n = 0;
  for (const k of running.keys()) {
    if (k.startsWith(projectHash + ":")) n++;
  }
  return n;
}

// 全 project 還在跑的條數(ticket + sync 都算)— 給 system update preflight 用
export function globalRunningCount(): number {
  return running.size;
}

// 順位(1-based);不在 queue 回 0
export function queuePosition(projectHash: string, pipelineId: string): number {
  const q = queues.get(projectHash);
  if (!q) return 0;
  const i = q.findIndex((it) => it.pipelineId === pipelineId);
  return i < 0 ? 0 : i + 1;
}

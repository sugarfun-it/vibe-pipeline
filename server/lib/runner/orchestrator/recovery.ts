import * as pipelineDir from "../../pipelineDir";
import * as notifs from "../../notifs/store";
import { isLegacyPausePendingState } from "./helpers";

// Crash recovery:server 啟動時掃 pipelines。兩種 inconsistency 都修:
// (a) pipeline.state="running"/"queued" 或舊版 pause-pending state 但 process / queue 不在
//     (in-memory state 隨 server 重啟蒸發)→ 標 paused
// (b) ticket.status="running" 但 pipeline 不是 running(任何 state)→ 標 paused
//
// (b) 處理上一次 server 死前 ticket 已寫 running,但 pipeline state 改回 paused 後沒同步 ticket
// 的殘留(畫面會出現 RunButton 顯「繼續」+ TicketCard 卻仍顯「執行中」的錯位)。
export async function recoverStale(projectPath: string): Promise<void> {
  const pipelines = (await pipelineDir.listPipelines(projectPath)) as Array<{
    id?: string;
    state?: string;
    tickets?: Array<{ status?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  }>;
  for (const p of pipelines) {
    if (!p.id) continue;
    const isStaleRunning =
      p.state === "running" || isLegacyPausePendingState(p.state) || p.state === "queued";
    const hasOrphanTicket =
      !isStaleRunning && p.state !== "running" &&
      (p.tickets ?? []).some((t) => t.status === "running");
    if (!isStaleRunning && !hasOrphanTicket) continue;

    const nextState = isStaleRunning ? "paused" : p.state;
    // stale running pipeline 視同 transient 失敗 — 主 agent 沒機會自標 paused 就被殺
    // (server restart / OS crash 等),running ticket 改 failed_transient + endedAt
    // 對齊 exit handler transient 路徑語義;user 按繼續會 reset 成 paused 再 reuse worktree。
    // 純 orphan ticket(pipeline 不是 running)維持改 paused — 那是「state 寫對 ticket 沒同步」
    // 的非 transient 殘留。
    const now = Date.now();
    const tickets = (p.tickets ?? []).map((t) => {
      if (t.status !== "running") return t;
      return isStaleRunning
        ? { ...t, status: "failed_transient", endedAt: now }
        : { ...t, status: "paused" };
    });
    await pipelineDir.writePipeline(projectPath, p.id, {
      ...p,
      state: nextState,
      tickets,
    }, {
      source: "startup-recover",
      sourceDetail: isStaleRunning
        ? `stale ${p.state} → paused on server boot`
        : "orphan running ticket fix",
      prevStateHint: typeof p.state === "string" ? p.state : undefined,
    });
    if (isStaleRunning) {
      const pName = (p as { name?: string }).name || p.id;
      notifs.emit(projectPath, {
        type: "pipeline_paused",
        title: `${pName} 因 server 重啟暫停`,
        sub: `runner child 已蒸發,worktree 進度保留;按繼續可從中斷處接`,
        pipelineId: p.id,
      });
    }
    console.log(
      `[runner] recovered stale pipeline ${p.id} (was ${p.state}) → ${nextState}, orphan tickets fixed`
    );
  }
}

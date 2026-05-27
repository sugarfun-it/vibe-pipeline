// Sync job 編排:把 base branch merge 進 pipeline worktree。
// 跟舊 sync ticket(append synthetic ticket 給 runner 跑)不同,這層直接走 git CLI,
// 只有有衝突時才 spawn AI 解;syncJob 寄生在 Pipeline.syncJob 欄位,不污染 tickets[]。
//
// State machine 見 shared/types.ts:SyncJobState。
//
// 三個 entry point:
//   - startSync(): 試 git merge --no-ff base。乾淨 / FF → done;衝突 → conflict_await
//   - confirmAi(): user 同意 AI 解衝突,spawn claude/codex,註冊進 running map
//   - cancelSync(): kill AI(若有)+ git merge --abort + 標 failed

import * as pipelineDir from "../../pipelineDir";
import * as worktree from "../../git/worktree";
import * as notifs from "../../notifs/store";
import * as orchestrator from "../orchestrator";
import type { SyncJob, SyncJobState } from "../../../../shared/types";
import type { PipelineLike } from "./state";
import { writeSyncJob } from "./state";

// 入口 1:嘗試 sync。流程:
//   1. read pipeline,確認沒在 running ticket / sync ai
//   2. behindCount === 0 → 直接寫 syncJob.done + return alreadyUpToDate
//   3. 寫 syncJob.state="merging"
//   4. worktree.mergeFromBase
//      - alreadyUpToDate → syncJob.done(理論上 step 2 已擋)
//      - ok + commit → syncJob.done + commit + emit sync_succeeded
//      - conflictFiles → syncJob.conflict_await + emit sync_conflict
//      - error → syncJob.failed + reason + emit sync_failed
export async function startSync(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<
  | { ok: true; state: SyncJobState; behind?: number; conflictFiles?: string[] }
  | { ok: false; error: string }
> {
  const { projectPath, projectHash, pipelineId } = opts;
  if (orchestrator.isRunning(projectHash, pipelineId)) {
    return { ok: false, error: "Pipeline 在跑或同步中,先完成或取消" };
  }
  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as PipelineLike | null;
  if (!p) return { ok: false, error: "Pipeline not found" };
  const baseBranch = p.baseBranch || "main";

  const behind = await worktree.behindBaseCount(projectPath, pipelineId, baseBranch);
  if (behind === null) {
    return { ok: false, error: "worktree 不存在,先跑 pipeline 一次再 sync" };
  }
  if (behind === 0) {
    // 沒落後 → 直接成功 + 短暫 done state(UI 短秒顯示後可以由 frontend 主動清掉)
    const job: SyncJob = {
      state: "done",
      startedAt: Date.now(),
      endedAt: Date.now(),
      behindCount: 0,
    };
    await writeSyncJob(projectPath, pipelineId, job);
    return { ok: true, state: "done", behind: 0 };
  }

  // 寫 merging state 讓前端可看「同步中」(雖然多半 <1s)
  const startedAt = Date.now();
  await writeSyncJob(projectPath, pipelineId, {
    state: "merging",
    startedAt,
    behindCount: behind,
  });
  notifs.emit(projectPath, {
    type: "sync_started",
    title: `${p.name || pipelineId} 同步啟動`,
    sub: `落後 ${behind} commits`,
    pipelineId,
  });

  const mergeRes = await worktree.mergeFromBase(projectPath, pipelineId, baseBranch);

  if (mergeRes.ok && mergeRes.alreadyUpToDate) {
    const job: SyncJob = {
      state: "done",
      startedAt,
      endedAt: Date.now(),
      behindCount: behind,
    };
    await writeSyncJob(projectPath, pipelineId, job);
    notifs.emit(projectPath, {
      type: "sync_succeeded",
      title: `${p.name || pipelineId} 同步完成`,
      sub: "已最新(無需 merge)",
      pipelineId,
    });
    return { ok: true, state: "done", behind: 0 };
  }

  if (mergeRes.ok && "commit" in mergeRes && mergeRes.commit) {
    const job: SyncJob = {
      state: "done",
      startedAt,
      endedAt: Date.now(),
      behindCount: behind,
      mergeCommit: mergeRes.commit,
    };
    await writeSyncJob(projectPath, pipelineId, job);
    notifs.emit(projectPath, {
      type: "sync_succeeded",
      title: `${p.name || pipelineId} 同步完成`,
      sub: `merge commit ${mergeRes.commit.hash.slice(0, 7)}`,
      pipelineId,
    });
    return { ok: true, state: "done", behind };
  }

  if (!mergeRes.ok && "conflictFiles" in mergeRes && mergeRes.conflictFiles) {
    const job: SyncJob = {
      state: "conflict_await",
      startedAt,
      behindCount: behind,
      conflictFiles: mergeRes.conflictFiles,
    };
    await writeSyncJob(projectPath, pipelineId, job);
    notifs.emit(projectPath, {
      type: "sync_conflict",
      title: `${p.name || pipelineId} 同步遇衝突`,
      sub: `${mergeRes.conflictFiles.length} 檔衝突,等使用者決定`,
      pipelineId,
    });
    return { ok: true, state: "conflict_await", behind, conflictFiles: mergeRes.conflictFiles };
  }

  const errMsg =
    !mergeRes.ok && "error" in mergeRes && typeof mergeRes.error === "string"
      ? mergeRes.error
      : "merge failed";
  // 走到這邊 = git merge 失敗但不是衝突。abort 一下確保 worktree 乾淨
  await worktree.mergeAbort(projectPath, pipelineId);
  const job: SyncJob = {
    state: "failed",
    startedAt,
    endedAt: Date.now(),
    behindCount: behind,
    reason: errMsg,
  };
  await writeSyncJob(projectPath, pipelineId, job);
  notifs.emit(projectPath, {
    type: "sync_failed",
    title: `${p.name || pipelineId} 同步失敗`,
    sub: errMsg.slice(0, 120),
    pipelineId,
  });
  return { ok: false, error: errMsg };
}

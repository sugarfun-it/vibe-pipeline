// 抽出 /merge endpoint 的核心邏輯,讓 HTTP handler 與 auto-merge trigger 共用同一條 path。
// 不做 self-HTTP call,純函式;呼叫端自己決定回什麼 HTTP status。

import { readPipeline, mutatePipeline } from "../domain/pipeline";
import { appendMergeTicket } from "../domain/mergeTicket";
import { FIXED_MERGE_STRATEGY } from "../domain/projectConfig";
import * as orchestrator from "../runner/orchestrator";
import * as git from "../io/git";
import * as worktree from "../io/git/worktree";
import * as notifs from "../remote/notifs";
import { mergeTicketPrompt } from "../runner/mergeTicketPrompt";
import { getTaskConfig } from "../domain/userConfig";
import { ensureDepsAfterMerge, type DepInstallResult } from "../system/depInstall";
import { runCapture } from "../io/childSpawn";

// Merge 完 worktree 已沒實質用途(branch 已併進 base,fs 是死副本)。
// 不刪 branch ref — 之後加新 ticket 仍可重新 attach worktree。
// 失敗只 warn + emit notif,不影響 mergeResult 成功訊號(Windows EPERM / fs lock 不該拖 merge 結果)。
async function autoCleanWorktreeAfterMerge(
  projectPath: string,
  pipelineId: string,
  pipelineName: string
): Promise<void> {
  try {
    const r = await worktree.removeQuiet(projectPath, pipelineId);
    if (!r.ok) {
      console.warn(`[merge ${pipelineId}] worktree prune failed: ${r.error}`);
      notifs.emit(projectPath, {
        type: "pipeline_merge_cleanup_failed",
        title: `${pipelineName} merge 後 worktree 清理失敗`,
        sub: r.error,
        pipelineId,
      });
    }
  } catch (e) {
    console.warn(`[merge ${pipelineId}] worktree prune threw:`, e);
  }
}

export type TriggerMergeResult =
  | { ok: true; ticketId: string; reused: boolean }
  | { ok: false; reason: "not_found"; error: string }
  | { ok: false; reason: "no_git"; error: string }
  | { ok: false; reason: "running"; error: string }
  | { ok: false; reason: "working_tree_dirty"; error: string; details: { modified: number; untracked: number; files: string[] } }
  | { ok: false; reason: "append_failed"; error: string }
  | { ok: false; reason: "spawn_failed"; error: string };

// 把 working tree 髒、pipeline 在跑、append / spawn 失敗等情況分成 reason 標籤,
// HTTP handler 把它對應到 status code,auto-trigger 寫進 lastAutoMergeError + notif。
export async function triggerMerge(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
  hasGit: boolean;
}): Promise<TriggerMergeResult> {
  const { projectPath, projectHash, pipelineId, hasGit } = opts;

  if (!hasGit) return { ok: false, reason: "no_git", error: "Project 沒 .git/" };
  if (orchestrator.isRunning(projectHash, pipelineId)) {
    return { ok: false, reason: "running", error: "Pipeline 在跑,先 pause 才能 merge" };
  }

  // Preflight:main repo working tree 必須乾淨
  const dirty = await git.workingTreeStatus(projectPath);
  if (!dirty.clean) {
    return {
      ok: false,
      reason: "working_tree_dirty",
      error:
        `main repo 有 ${dirty.modified} 個 modified + ${dirty.untracked} 個 untracked,` +
        `先 commit 或 stash 再 AI 合併(避免 merge 動到 user 沒存的工作)。`,
      details: { modified: dirty.modified, untracked: dirty.untracked, files: dirty.files },
    };
  }

  const pipeline = (await readPipeline(projectPath, pipelineId)) as {
    name?: string;
    branch?: string;
    baseBranch?: string;
    state?: string;
    tickets?: Array<{
      n?: number;
      title?: string;
      mode?: string;
      goal?: string;
      acceptance?: string[];
      commits?: Array<{ hash?: string; subject?: string }>;
    }>;
    [k: string]: unknown;
  } | null;
  if (!pipeline) return { ok: false, reason: "not_found", error: `Pipeline not found: ${pipelineId}` };

  const branch = pipeline.branch || `pipeline/${pipeline.name || pipelineId}`;
  const baseBranch = pipeline.baseBranch || "main";
  const strategy = FIXED_MERGE_STRATEGY;

  const history = (pipeline.tickets ?? [])
    .filter((t) => t.mode !== "merge")
    .map((t) => ({
      n: typeof t.n === "number" ? t.n : 0,
      title: t.title ?? "(no title)",
      mode: t.mode,
      goal: t.goal,
      acceptance: t.acceptance,
      commits: (t.commits ?? [])
        .map((c) => ({ hash: c.hash ?? "", subject: c.subject ?? "" }))
        .filter((c) => c.hash || c.subject),
    }));

  const mergeCfg = await getTaskConfig("merge");
  const prompt = mergeTicketPrompt({
    projectPath,
    branch,
    baseBranch,
    strategy,
    history,
    modelHint: { model: mergeCfg.model, effort: mergeCfg.effort },
  });

  const appendRes = await appendMergeTicket({
    projectPath,
    pipelineId,
    prompt,
  });
  if (!appendRes.ok) return { ok: false, reason: "append_failed", error: appendRes.error };

  const startRes = await orchestrator.start({
    projectPath,
    projectHash,
    pipelineId,
  });
  if (!startRes.ok) {
    // 補救:append 了但 spawn 失敗 → 把 merge ticket 拔掉避免之後干擾
    const appendedId = appendRes.ticket.id as string;
    try {
      await mutatePipeline(projectPath, pipelineId, (p) => ({
        ...p,
        tickets: (p.tickets ?? []).filter((t) => t.mode !== "merge" || t.id !== appendedId),
      }), {
        source: "merge-ai-spawn-rollback",
        sourceDetail: "spawn failed, remove appended merge ticket",
      });
    } catch {
      // pipeline 不見就算了,反正 spawn 也失敗
    }
    return { ok: false, reason: "spawn_failed", error: `append OK but spawn failed: ${startRes.error}` };
  }
  return { ok: true, ticketId: appendRes.ticket.id as string, reused: appendRes.reused };
}

// ─────────────────────────────────────────────────────────────────────
// Backend-only auto merge(2026-05-13)— autoMerge=true 場景走這條,不 spawn AI。
// 純 git CLI:checkout base → merge --no-ff pipelineBranch。
// clean → 寫 pipeline.state="merged" + mergeCommit;
// conflict → git merge --abort + 回 conflictFiles,**不自動派 AI 解**(user 看 notif 主動觸發 manual AI merge)
// 心智:autoMerge 是「便利開關」,風險(燒 token 解衝突)決策回到 user

export type AutoMergeResult =
  | { ok: true; mergeCommit: { hash: string; subject: string; ts: number }; behindCount: number; depInstall?: DepInstallResult }
  | { ok: true; alreadyMerged: true }
  | { ok: false; reason: "no_git" | "not_found" | "running" | "working_tree_dirty"; error: string }
  | { ok: false; reason: "conflict"; error: string; conflictFiles: string[] }
  | { ok: false; reason: "git_error"; error: string };

async function spawnGit(args: string[], cwd: string): Promise<{ ok: boolean; out: string; err: string }> {
  const r = await runCapture(["git", ...args], { cwd });
  return { ok: r.ok, out: r.out.trim(), err: r.err.trim() };
}

export async function autoMergeNoAI(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
  hasGit: boolean;
}): Promise<AutoMergeResult> {
  const { projectPath, projectHash, pipelineId, hasGit } = opts;

  if (!hasGit) return { ok: false, reason: "no_git", error: "Project 沒 .git/" };
  if (orchestrator.isRunning(projectHash, pipelineId)) {
    return { ok: false, reason: "running", error: "Pipeline 在跑,先 pause 才能 merge" };
  }

  const dirty = await git.workingTreeStatus(projectPath);
  if (!dirty.clean) {
    return {
      ok: false,
      reason: "working_tree_dirty",
      error:
        `main repo 有 ${dirty.modified} 個 modified + ${dirty.untracked} 個 untracked,` +
        `先 commit 或 stash 再讓 auto-merge 推進(避免 merge 動到 user 沒存的工作)。`,
    };
  }

  const pipeline = (await readPipeline(projectPath, pipelineId)) as {
    name?: string;
    branch?: string;
    baseBranch?: string;
    [k: string]: unknown;
  } | null;
  if (!pipeline) return { ok: false, reason: "not_found", error: `Pipeline not found: ${pipelineId}` };

  const pipelineBranch = pipeline.branch || `pipeline/${pipeline.name || pipelineId}`;
  const baseBranch = pipeline.baseBranch || "main";

  // 看當前 base 已經包含 pipeline branch 沒(已 merge 過 / no-op)
  const ahead = await spawnGit(["rev-list", "--count", `${baseBranch}..${pipelineBranch}`], projectPath);
  if (ahead.ok && ahead.out === "0") {
    // pipeline branch 沒任何 commit 在 base 之外 — git 層已 merge 完,把 pipeline state 補成 merged
    // 同時清掉殘存的 failed/paused merge ticket(那是之前 AI 嘗試失敗留的,不該繼續觸發 banner 顯「重試」)
    try {
      await mutatePipeline(projectPath, pipelineId, (p) => {
        if (p.state === "merged") return p;
        const tickets = (p.tickets ?? []).map((t) => {
          if (
            t.mode === "merge" &&
            (t.status === "failed" ||
              t.status === "failed_iter_limit" ||
              t.status === "failed_transient" ||
              t.status === "paused")
          ) {
            return { ...t, status: "done" as const };
          }
          return t;
        });
        return {
          ...p,
          tickets,
          state: "merged",
          lastAutoMergeError: undefined,
        };
      }, {
        source: "merge-mechanical-already",
        sourceDetail: "ahead=0 → already merged, sync state",
      });
    } catch {
      // pipeline 不見就算了
    }
    await autoCleanWorktreeAfterMerge(projectPath, pipelineId, pipeline.name || pipelineId);
    return { ok: true, alreadyMerged: true };
  }

  // 1. checkout base
  const co = await spawnGit(["checkout", baseBranch], projectPath);
  if (!co.ok) {
    return { ok: false, reason: "git_error", error: `checkout ${baseBranch} 失敗:${co.err || co.out}` };
  }

  // 2. merge --no-ff(走 fixed 策略,同 AI merge ticket)
  const msg = `Merge pipeline/${pipeline.name || pipelineId} into ${baseBranch} (auto)`;
  const mergeRes = await spawnGit(
    ["merge", "--no-ff", "-m", msg, pipelineBranch],
    projectPath
  );

  if (mergeRes.ok) {
    const headRes = await spawnGit(["rev-parse", "HEAD"], projectPath);
    const subjRes = await spawnGit(["log", "-1", "--format=%s"], projectPath);
    const ts = Date.now();
    const mergeCommit = {
      hash: headRes.out.trim(),
      subject: subjRes.out.trim() || msg,
      ts,
    };
    // 寫 pipeline state=merged + mergeCommit + mergedAt
    try {
      await mutatePipeline(projectPath, pipelineId, (p) => ({
        ...p,
        state: "merged",
        mergedAt: ts,
        mergeCommit,
        lastAutoMergeError: undefined,
      }), {
        source: "merge-mechanical-success",
        sourceDetail: `git merge --no-ff ${mergeCommit.hash.slice(0, 7)}`,
      });
    } catch {
      // pipeline 不見就算了,git 已 merge 成功
    }
    const aheadNum = Number(ahead.out) || 0;
    const depInstall = await ensureDepsAfterMerge(projectPath, mergeCommit.hash);
    await autoCleanWorktreeAfterMerge(projectPath, pipelineId, pipeline.name || pipelineId);
    return { ok: true, mergeCommit, behindCount: aheadNum, depInstall };
  }

  // merge 失敗:看是不是衝突
  const status = await spawnGit(["status", "--porcelain"], projectPath);
  const conflictFiles = status.ok
    ? status.out
        .split(/\r?\n/)
        .filter((l) => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(l))
        .map((l) => l.replace(/^..\s+/, ""))
    : [];

  // abort 把 working tree 回原狀(unstaged conflicts 不會 leak)
  await spawnGit(["merge", "--abort"], projectPath);

  if (conflictFiles.length > 0) {
    return {
      ok: false,
      reason: "conflict",
      error: `${conflictFiles.length} 個檔案衝突,auto-merge 不自動 AI 解;user 可手動點「AI 合併」走完整 AI 流程`,
      conflictFiles,
    };
  }

  return { ok: false, reason: "git_error", error: mergeRes.err || mergeRes.out || "merge failed" };
}

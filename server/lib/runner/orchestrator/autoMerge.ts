import { readPipeline, writePipeline } from "../../domain/pipeline";
import * as notifs from "../../remote/notifs";

// Pipeline 進入 ready 後,若 autoMerge=true 且當前 state=ready → 自動觸發 AI 合併。
// 走跟手動 /merge 同一條 triggerMerge,因此 slot 滿會自然進 queue。
// 失敗(working tree 髒 / spawn 失敗等)→ 寫 lastAutoMergeError + emit notif,不重試。
// 用 dynamic import 避免 orchestrator <-> pipelineMerge 循環(pipelineMerge 也 import 本檔)。
export async function maybeAutoMerge(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<void> {
  const { projectPath, projectHash, pipelineId } = opts;
  const pipeline = (await readPipeline(projectPath, pipelineId)) as {
    state?: string;
    name?: string;
    autoMerge?: boolean;
    [k: string]: unknown;
  } | null;
  if (!pipeline) return;
  // 自動 merge 觸發條件:autoMerge=true && state===ready && 不在 merged/merging/failed
  // (merged 已合過、merging 沒這個 state、failed 不重試)
  if (!pipeline.autoMerge) return;
  if (pipeline.state !== "ready") return;

  const name = pipeline.name || pipelineId;
  notifs.emit(projectPath, {
    type: "pipeline_auto_merge_started",
    title: `${name} 自動合併已觸發`,
    sub: "全 ticket done → autoMerge=true",
    pipelineId,
  });

  // 清掉之前的 lastAutoMergeError(重新嘗試)
  if (pipeline.lastAutoMergeError !== undefined) {
    await writePipeline(projectPath, pipelineId, {
      ...pipeline,
      lastAutoMergeError: undefined,
    }, {
      source: "maybeAutoMerge",
      sourceDetail: "clear lastAutoMergeError before retry",
      prevStateHint: typeof pipeline.state === "string" ? pipeline.state : undefined,
    });
  }

  try {
    // 2026-05-13 改:auto-merge 二段式。
    // 1. backend-only git merge(autoMergeNoAI)→ clean 秒結束、寫 state=merged
    // 2. 撞衝突 → 自動 fallback 到 triggerMerge(spawn AI runner 全套),同 manual merge 路徑
    //    心智:autoMerge=true 是「全自動」承諾,user 不想自己決定燒 token;
    //    速度收益保留在 clean 場景(~90%),衝突場景跟過去一樣慢但無人值守
    // 其他失敗(dirty / git_error)→ 不 fallback AI(那不是 AI 能解的),emit merge_blocked 等 user
    // dynamic import 拆循環依賴
    const { autoMergeNoAI, triggerMerge } = await import("../../services/pipelineMerge");
    const r = await autoMergeNoAI({
      projectPath,
      projectHash,
      pipelineId,
      hasGit: true,
    });
    if (r.ok) {
      const sub = "mergeCommit" in r && r.mergeCommit
        ? `merge commit ${r.mergeCommit.hash.slice(0, 7)}`
        : "已最新(無 commit 可合)";
      notifs.emit(projectPath, {
        type: "pipeline_merged",
        title: `${name} 自動合併完成`,
        sub,
        pipelineId,
      });
      return;
    }

    // 失敗分流:conflict → 自動升級走 AI;其他 → emit merge_blocked 等 user
    if (r.reason === "conflict") {
      const fileCount = "conflictFiles" in r ? r.conflictFiles.length : 0;
      notifs.emit(projectPath, {
        type: "pipeline_auto_merge_started",
        title: `${name} 撞衝突,升級走 AI 合併`,
        sub: `${fileCount} 衝突檔,backend 已 abort merge,改 spawn AI`,
        pipelineId,
      });
      // FCM push:user 可能不在 UI(autoMerge 場景就是要無人值守);告知 AI 接手了
      const { pushToEvent, boardUrl } = await import("../../remote/push/pushToEvent");
      pushToEvent({
        eventKey: "auto_merge_conflict",
        title: `🤖 ${name} AI 接手解衝突`,
        body: `自動合併撞 ${fileCount} 個衝突檔,AI 開始處理`,
        projectHash,
        workUnitId: pipelineId,
        url: boardUrl(projectHash, pipelineId),
      });
      const ai = await triggerMerge({
        projectPath,
        projectHash,
        pipelineId,
        hasGit: true,
      });
      if (!ai.ok) {
        const cur = (await readPipeline(projectPath, pipelineId)) as {
          state?: string;
          [k: string]: unknown;
        } | null;
        if (cur) {
          await writePipeline(projectPath, pipelineId, {
            ...cur,
            lastAutoMergeError: ai.error,
          }, {
            source: "maybeAutoMerge",
            sourceDetail: `AI fallback failed: ${ai.error}`,
            prevStateHint: typeof cur.state === "string" ? cur.state : undefined,
          });
        }
        notifs.emit(projectPath, {
          type: "merge_blocked",
          title: `${name} 自動合併升級 AI 也失敗`,
          sub: ai.error,
          pipelineId,
        });
      }
      return;
    }

    // dirty / git_error / not_found / running — 不適合 AI 自動解,emit merge_blocked
    const cur = (await readPipeline(projectPath, pipelineId)) as {
      state?: string;
      [k: string]: unknown;
    } | null;
    if (cur) {
      await writePipeline(projectPath, pipelineId, {
        ...cur,
        lastAutoMergeError: r.error,
      }, {
        source: "maybeAutoMerge",
        sourceDetail: `auto-merge blocked: ${r.error}`,
        prevStateHint: typeof cur.state === "string" ? cur.state : undefined,
      });
    }
    notifs.emit(projectPath, {
      type: "merge_blocked",
      title: `${name} 自動合併失敗`,
      sub: r.error,
      pipelineId,
    });
  } catch (e) {
    console.error(`[autoMerge ${pipelineId}] failed:`, e);
  }
}

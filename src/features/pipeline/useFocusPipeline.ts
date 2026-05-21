import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi";
import * as api from "../../api/projects";
import type { RunSummary } from "../../api/projects";
import { STATE_COLOR, STATE_LABEL } from "../../data/pipelines";
import type { Pipeline } from "../../types/pipeline";

export type UseFocusPipelineOpts = {
  projectHash: string | undefined;
  pipeline: Pipeline;
  reloadKey: number;
  onRun?: (pipelineId: string) => void;
};

export type UseFocusPipelineResult = {
  diffStat: api.DiffStat | null;
  syncStatus: api.SyncStatus | null;
  runs: RunSummary[];
  spawning: boolean;
  onStart: (pipelineId: string) => void;
  // derived display state
  behind: number | null;
  totalCost: number;
  stateColor: string;
  stateLabel: string;
  done: number;
  total: number;
  noWorktreeDiff: boolean;
  showMergeBanner: boolean;
  syncActive: boolean;
  lockedByState: boolean;
};

export function useFocusPipeline(opts: UseFocusPipelineOpts): UseFocusPipelineResult {
  const { projectHash, pipeline, reloadKey, onRun } = opts;

  // Runs summary 給 head chip + RunButton 預估用。pipeline.id / state 變動就 refetch
  // (state 變表示可能新跑完一次)。失敗安靜忽略 — 純資訊性。
  const [runs, setRuns] = useState<RunSummary[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pipeline.state is the refetch trigger (state change ≈ new run)
  useEffect(() => {
    if (!projectHash) return;
    let cancelled = false;
    api
      .listPipelineRuns(projectHash, pipeline.id)
      .then((arr) => {
        if (!cancelled) setRuns(arr);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectHash, pipeline.id, pipeline.state]);

  // Worktree diff stat — fetch once on mount(讓 paused/ready 也看得到歷史 diff),
  // running 時 poll 每 3s 看即時進度。merged 後不打(已合進 base 沒意義)。
  const diffStatEnabled = !!projectHash && pipeline.state !== "merged" && pipeline.state !== "planning";
  const diffLive = pipeline.state === "running";
  const { data: diffStat } = useApi<api.DiffStat | null>(
    () => (diffStatEnabled ? api.getDiffStat(projectHash!, pipeline.id) : Promise.resolve(null)),
    {
      // 10s — 1 次 git diff 在 Windows fork 5 個 helper subprocess(15 個視窗),3s 太貴
      intervalMs: 10000,
      gate: diffLive,
      // reloadKey:user 手動 trigger(prune worktree / run / stop 等)立刻 refetch,不等 polling
      deps: [projectHash, pipeline.id, pipeline.state, reloadKey],
    }
  );

  // Sync status — worktree 落後 base 幾個 commit。planning 沒 worktree 不抓;merged 仍然抓
  // (merged 不是終態,branch/worktree 還在,可以繼續加 ticket / sync / 再 merge)。
  // 跟 diffStat 同節奏:running 才 poll(base 那時可能被別條 pipeline 推進);
  // 其他 state 一次抓完,不同 pipeline.state 自動 refetch。
  // syncJob.state 也當 deps:user 點 ✕ 關掉 done/failed chip → syncJob undefined → 觸發 refetch
  // 否則 chip 消失但「落後 N · 同步」按鈕要等下次 polling 才出現
  const syncJobState = pipeline.syncJob?.state;
  // merged 排除 — 已合進 base 沒「落後」概念,sync chip 無意義;打了也只是浪費 git spawn
  // (pipelinesResult 每 5s refetch → pipeline reference 變 → deps trigger → 持續 fire)
  const syncEnabled = !!projectHash && pipeline.state !== "planning" && pipeline.state !== "merged";
  const syncLive = pipeline.state === "running";
  const { data: syncStatus } = useApi<api.SyncStatus | null>(
    () => (syncEnabled ? api.getSyncStatus(projectHash!, pipeline.id) : Promise.resolve(null)),
    {
      // 30s — base branch 不會 30s 內推 N commit,5s 過頻;1 次 rev-list 在 Windows 12 個視窗
      intervalMs: 30000,
      gate: syncLive,
      deps: [projectHash, pipeline.id, pipeline.state, syncJobState, reloadKey],
    }
  );

  // Spawning state:點 開始/繼續/重試 後到 polling 看到 state 跳出 [planning/paused/failed]。
  // 解掉「點下去看似沒反應」的視覺空窗(POST 回 → state.json 寫入 → polling 抓到 ≤ 1.5s + claude 啟動 0~5s)。
  const [spawning, setSpawning] = useState(false);
  // pipeline.state 跳出可點擊狀態 = 真的進場了 → 清 spawning
  useEffect(() => {
    if (
      pipeline.state !== "planning" &&
      pipeline.state !== "paused" &&
      pipeline.state !== "failed"
    ) {
      setSpawning(false);
    }
  }, [pipeline.state]);
  // 安全網:15s 還沒進場視同失敗(打了 API 沒生效),解除 spawning 讓 user 重試
  useEffect(() => {
    if (!spawning) return;
    const id = setTimeout(() => setSpawning(false), 15000);
    return () => clearTimeout(id);
  }, [spawning]);

  const onStart = (pid: string) => {
    setSpawning(true);
    onRun?.(pid);
  };

  const behind = syncStatus?.behind ?? null;
  const totalCost = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const stateColor = STATE_COLOR[pipeline.state];
  const stateLabel = STATE_LABEL[pipeline.state];
  // mode=sync 是舊 synthetic ticket(已換 pipeline.syncJob),不計入 done/total
  const realTickets = pipeline.tickets.filter((t) => t.mode !== "sync");
  const done = realTickets.filter((t) => t.status === "done").length;
  const total = realTickets.length;
  const allDone = done === total && pipeline.state === "ready";
  // 看是否有失敗 / paused 的 merge ticket(讓 banner 顯重試,不靠 RunButton 的繼續)
  const failedMergeTicket = pipeline.tickets.find(
    (t) =>
      t.mode === "merge" &&
      (t.status === "failed" ||
        t.status === "failed_iter_limit" ||
        t.status === "failed_transient" ||
        t.status === "paused")
  );
  // ready = 全 ticket done 還沒合併;merged = 已合併;有失敗 merge → 也顯 banner 給 user 重試。
  // 防護網:worktree 跟 base 沒 diff(rebase 完了 / 已 merged 過再 sync 完了 / 純讀 ticket)
  // → allDone 路徑不顯 merge prompt(merge 出去也是 no-op);merged / failedMerge 仍顯
  // (前者是「✓ 已合併」狀態 banner,後者要 user 重試,不分 diff)。
  const noWorktreeDiff = diffStat !== null && diffStat !== undefined && diffStat.files === 0 && diffStat.added === 0 && diffStat.deleted === 0;
  const showMergeBanner =
    (allDone && !noWorktreeDiff) ||
    pipeline.state === "merged" ||
    !!failedMergeTicket;
  const syncActive =
    !!pipeline.syncJob &&
    (pipeline.syncJob.state === "merging" ||
      pipeline.syncJob.state === "conflict_await" ||
      pipeline.syncJob.state === "ai_running");
  const lockedByState =
    pipeline.state === "running" ||
    pipeline.state === "queued" ||
    syncActive;

  return {
    diffStat: diffStat ?? null,
    syncStatus: syncStatus ?? null,
    runs,
    spawning,
    onStart,
    behind,
    totalCost,
    stateColor,
    stateLabel,
    done,
    total,
    noWorktreeDiff,
    showMergeBanner,
    syncActive,
    lockedByState,
  };
}

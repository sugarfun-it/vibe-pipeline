import { fmtDuration } from "../../data/pipelines";
import type { Pipeline, PipelineState } from "../../types/pipeline";
import type { RunSummary } from "../../api/projects";

// RunButton 狀態決策表(authoritative)— 加新 PipelineState 一定要在 switch 補,
// 不然 TS exhaustive `never` 編譯就 fail。
export function RunButton({
  pipeline,
  onRun,
  onStop,
  lastRun,
  spawning = false,
  queuePosition,
  syncActive = false,
}: {
  pipeline: Pipeline;
  onRun?: (id: string) => void;
  onStop?: (id: string) => void;
  lastRun?: RunSummary | null;
  // user 點 開始/繼續/重試 後 → 等 polling 看到 state 跳出 planning/paused/failed 為止
  // 避開「點下去看似沒反應」的視覺空窗(POST 回來到第一個 ticket 真跑可能 0-7s)
  spawning?: boolean;
  queuePosition?: number;
  // syncJob.state ∈ {merging, conflict_await, ai_running} → RunButton 一律 disabled,避免撞 worktree
  syncActive?: boolean;
}) {
  const s = pipeline.state as PipelineState;
  const noTickets = pipeline.tickets.length === 0;
  const lastDur = lastRun?.durationMs ? fmtDuration(lastRun.durationMs) : null;

  // sync 進行中:RunButton 完全鎖,顯示「同步中」覆蓋,避免 user 誤觸發 runner 撞 worktree
  if (syncActive) {
    return (
      <button type="button" className="btn" disabled title="同步進行中,等同步收尾才能跑 ticket">
        <span className="qadr-thinking-dots">
          <span /><span /><span />
        </span>{" "}
        同步中
      </button>
    );
  }

  // spawning 期間統一顯「啟動中…」覆蓋掉原本的「開始/繼續/重試」狀態
  if (
    spawning &&
    (s === "planning" || s === "paused" || s === "failed" || s === "ready" || s === "merged")
  ) {
    return (
      <button type="button" className="btn" disabled title="啟動 runner session…">
        <span className="qadr-thinking-dots">
          <span /><span /><span />
        </span>{" "}
        啟動中
      </button>
    );
  }

  switch (s) {
    case "running":
      return (
        <button
          type="button"
          className="btn btn-danger run-btn-stop-now"
          onClick={() => onStop?.(pipeline.id)}
          title="停止"
          aria-label="停止"
        >
          ⏹ 停止
        </button>
      );
    case "queued": {
      const posLabel = queuePosition && queuePosition > 0 ? `順位 ${queuePosition}` : "排隊中";
      return (
        <button
          type="button"
          className="btn"
          onClick={() => onStop?.(pipeline.id)}
          title="取消排隊"
          style={{ color: "var(--queued)", borderColor: "var(--queued)" }}
        >
          ⏳ {posLabel}
        </button>
      );
    }
    case "planning":
    case "paused":
    case "failed":
    case "ready":
    case "merged": {
      // 沒「可跑」的 real ticket = 沒 ticket / 都 done / 只剩 merge ticket(retry 走 banner)。
      // merge / sync ticket 不認列(synthetic,各自有 banner / chip 觸發)。
      // failed_transient 也算可跑 — backend `runPipeline` handler 會 auto-reset 成 paused 再續跑
      // (server restart / OS crash 等情況留下,user 按繼續無痛接回)。
      const hasRunnableReal = pipeline.tickets.some(
        (t) =>
          t.mode !== "merge" &&
          t.mode !== "sync" &&
          (t.status === "draft" || t.status === "ready" || t.status === "paused" || t.status === "failed_transient")
      );
      if (noTickets || !hasRunnableReal) {
        const title = noTickets
          ? "按上方「+ ticket」開 QA 建第一張"
          : "沒可跑的 ticket(失敗 / done 不算可跑;merge / sync 處理走 banner / chip)";
        return (
          <button type="button" className="btn run-btn-empty" disabled title={title}>
            無ticket可執行
          </button>
        );
      }
      const titleBase =
        s === "paused" ? "繼續" : s === "failed" ? "重試" : s === "merged" ? "再跑一輪" : "開始運行";
      const title = lastDur ? `${titleBase}(上次 ${lastDur})` : titleBase;
      return (
        <button type="button"
          className="btn btn-primary"
          onClick={() => onRun?.(pipeline.id)}
          title={title}
        >
          ▶ {titleBase}
          {lastDur && (
            <span className="mono focus-run-duration">
              ~{lastDur}
            </span>
          )}
        </button>
      );
    }
    default: {
      // exhaustive check:加新 PipelineState 沒在上面 case 補,這裡會 type error
      const _exhaustive: never = s;
      void _exhaustive;
      return null;
    }
  }
}

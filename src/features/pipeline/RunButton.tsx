import type { Pipeline, PipelineState } from "../../types/pipeline";

// RunButton 狀態決策表(authoritative)— 加新 PipelineState 一定要在 switch 補,
// 不然 TS exhaustive `never` 編譯就 fail。
//
// 設計原則(2026-05-22 全盤重整):
// 1. clickable button 用 verb(停止 / 取消 / 繼續 / 重試 / 執行),disabled 用 gerund(同步中 / 啟動中 / 排隊中)
// 2. queued button 顯示順位 + 「· 取消」明示 click 行為(避免單 button 兩 mental model)
// 3. tooltip 只在能加 extra info 時保留;跟可見文字重複的 tooltip 砍掉
// 4. 不秀「上次跑多久」— scope 不對等(button 跑 runnable subset,lastDur 是上次全 pipeline)+
//    `~` 符號讓人誤以為 estimate 實際是 literal,Pure noise。歷史時間查 RunHistory 看完整紀錄
// 5. planning / ready / merged 收斂到單一 verb「執行」— state 差異看 Rail badge,button 不重複
export function RunButton({
  pipeline,
  onRun,
  onStop,
  spawning = false,
  queuePosition,
  syncActive = false,
}: {
  pipeline: Pipeline;
  onRun?: (id: string) => void;
  onStop?: (id: string) => void;
  // user 點 開始/繼續/重試 後 → 等 polling 看到 state 跳出 planning/paused/failed 為止
  // 避開「點下去看似沒反應」的視覺空窗(POST 回來到第一個 ticket 真跑可能 0-7s)
  spawning?: boolean;
  queuePosition?: number;
  // syncJob.state ∈ {merging, conflict_await, ai_running} → RunButton 一律 disabled,避免撞 worktree
  syncActive?: boolean;
}) {
  const s = pipeline.state as PipelineState;
  const noTickets = pipeline.tickets.length === 0;

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
      <button type="button" className="btn" disabled title="啟動 runner session(通常 1-5 秒)">
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
          style={{ color: "var(--queued)", borderColor: "var(--queued)" }}
        >
          ⏳ {posLabel} · 取消
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
          : "merge / sync 操作從上方 banner 觸發;done / failed 不算可跑";
        return (
          <button type="button" className="btn run-btn-empty" disabled title={title}>
            無可跑的 ticket
          </button>
        );
      }
      // paused / failed 共用 button 但語意明示;其他都「執行」(planning/ready/merged 不細分)
      const label =
        s === "paused" ? "繼續" : s === "failed" ? "重試" : "執行";
      return (
        <button type="button"
          className="btn btn-primary"
          onClick={() => onRun?.(pipeline.id)}
        >
          ▶ {label}
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

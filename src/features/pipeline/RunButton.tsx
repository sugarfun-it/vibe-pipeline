import type { CSSProperties } from "react";
import type { Pipeline, PipelineState } from "../../types/pipeline";
import { HourglassIcon, PlayIcon, StopIcon } from "../../ui/icons";

// RunButton 狀態決策表(authoritative)— 加新 PipelineState 一定要在 switch 補,
// 不然 TS exhaustive `never` 編譯就 fail。
//
// 設計原則:
// 1. clickable button 用 verb(停止 / 取消 / 繼續 / 重試 / 執行),disabled 用 gerund(同步中 / 啟動中)
// 2. queued button 顯示順位 + 「· 取消」明示 click 行為(避免單 button 兩 mental model);用 aria-label 明示動作避免誤點
// 3. running 永遠保留「停止」可用 — sync / spawn 訊號不擋它,否則 runner 跑壞時 user 無從中斷
// 3a. queued 也永遠保留「取消」可用(不擋 sync / spawn)— 取消排隊不碰 worktree,user 隨時能離場
// 4. disabled 的原因不只靠 native title(touch/keyboard/SR 不可靠),用 visually-hidden span + aria-describedby 補
// 4a. busy 變體(同步中 / 啟動中)加 role=status + aria-live=polite,SR 在文字轉換時主動播報
// 5. icon SVG(PlayIcon / StopIcon / HourglassIcon)用 aria-hidden 包,SR 只念 verb / 狀態文字
// 6. planning / ready / merged 收斂到單一 verb「執行」— state 差異看 Rail badge,button 不重複
//
// Phase 4 待整理(non-owned files):
// - srOnly 抽到 src/styles/.sr-only utility class
// - queued 變體的 inline `var(--queued)` 抽成 btn-queued class
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

  // 視覺隱藏 helper(SR 用):title 不可靠(touch / keyboard / 螢幕閱讀器),
  // 但目前 owned scope 只有 RunButton.tsx + 不允許動 styles/。先 inline style,
  // 等 Phase 4 收斂到共用 .sr-only class。
  const srOnly: CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  };

  // running 狀態優先 — 即使 sync / spawn 同時觸發也要保留「停止」可用,
  // 否則 user 在 runner 跑壞時無法緊急中斷。
  if (s === "running") {
    return (
      <button
        type="button"
        className="btn btn-danger run-btn-stop-now"
        onClick={() => onStop?.(pipeline.id)}
        aria-label="停止 pipeline"
        title={syncActive ? "同步進行中,但 runner 仍可停止" : undefined}
      >
        <span aria-hidden="true"><StopIcon /></span> 停止
      </button>
    );
  }

  // queued 提前於 sync / spawn — 取消排隊只是改 queue position,不會碰 worktree,
  // 不該被 syncActive / spawning 鎖死。同 running 一樣保留 user 的「離場」路徑。
  if (s === "queued") {
    const hasPos = !!(queuePosition && queuePosition > 0);
    const posLabel = hasPos ? `順位 ${queuePosition}` : "排隊中";
    const ariaLabel = hasPos
      ? `取消排隊(目前順位 ${queuePosition})`
      : "取消排隊";
    return (
      <button
        type="button"
        className="btn"
        onClick={() => onStop?.(pipeline.id)}
        aria-label={ariaLabel}
        style={{ color: "var(--queued)", borderColor: "var(--queued)" }}
      >
        <span aria-hidden="true"><HourglassIcon /></span> {posLabel} · 取消
      </button>
    );
  }

  // sync 進行中:其餘狀態 RunButton 鎖死,避免 user 誤觸發 runner 撞 worktree
  // 用 aria-disabled + onClick noop 取代 native `disabled`,讓 keyboard / SR 仍可 focus 看到 helper text
  // role=status + aria-live=polite:SR 在 「執行」→「同步中」轉換時主動播報
  if (syncActive) {
    const reason = "同步收尾後可執行 ticket";
    const helpId = `run-btn-sync-help-${pipeline.id}`;
    return (
      <button
        type="button"
        className="btn"
        aria-disabled="true"
        aria-describedby={helpId}
        role="status"
        aria-live="polite"
        title={reason}
      >
        <span className="qadr-thinking-dots" aria-hidden="true">
          <span /><span /><span />
        </span>{" "}
        同步中
        <span style={srOnly} id={helpId}>{reason}</span>
      </button>
    );
  }

  // spawning 期間統一顯「啟動中…」覆蓋掉原本的「開始/繼續/重試」狀態
  // 同 syncActive:role=status + aria-live=polite 讓 SR 主動播報啟動轉換
  if (
    spawning &&
    (s === "planning" || s === "paused" || s === "failed" || s === "ready" || s === "merged")
  ) {
    const reason = "啟動 runner(約 1-5 秒)";
    const helpId = `run-btn-spawn-help-${pipeline.id}`;
    return (
      <button
        type="button"
        className="btn"
        aria-disabled="true"
        aria-describedby={helpId}
        role="status"
        aria-live="polite"
        title={reason}
      >
        <span className="qadr-thinking-dots" aria-hidden="true">
          <span /><span /><span />
        </span>{" "}
        啟動中
        <span style={srOnly} id={helpId}>{reason}</span>
      </button>
    );
  }

  switch (s) {
    case "planning":
    case "paused":
    case "failed":
    case "ready":
    case "merged": {
      // 沒「可跑」的 real ticket = 沒 ticket / 都 done / 只剩 merge ticket(retry 走 banner)。
      // merge / sync ticket 不認列(synthetic,各自有 banner / chip 觸發)。
      // failed_transient 也算可跑 — backend `runPipeline` handler 會 auto-reset 成 paused 再續跑。
      const hasRunnableReal = pipeline.tickets.some(
        (t) =>
          t.mode !== "merge" &&
          t.mode !== "sync" &&
          (t.status === "draft" || t.status === "ready" || t.status === "paused" || t.status === "failed_transient")
      );
      if (noTickets || !hasRunnableReal) {
        // helper copy 按實際原因走,不混在一句長文裡;failed_transient 不會落到這裡(算 runnable)。
        const reason = noTickets
          ? "上方「+ 新增 ticket」開 QA 建第一張"
          : "目前 ticket 都已完成或永久失敗;新增或修復 ticket 後即可執行";
        const helpId = `run-btn-empty-help-${pipeline.id}`;
        // aria-disabled (而非 native disabled)讓 keyboard 仍可 focus 看 helper text
        return (
          <button
            type="button"
            className="btn run-btn-empty"
            aria-disabled="true"
            aria-describedby={helpId}
            title={reason}
          >
            <span className="run-btn-empty-label-full">無可執行 ticket</span>
            <span className="run-btn-empty-label-short" aria-hidden>無可執行</span>
            <span style={srOnly} id={helpId}>{reason}</span>
          </button>
        );
      }
      // paused / failed 共用 button 但語意明示;其他都「執行」(planning/ready/merged 不細分)
      const label =
        s === "paused" ? "繼續" : s === "failed" ? "重試" : "執行";
      const ariaLabel =
        s === "paused" ? "繼續執行 pipeline" :
        s === "failed" ? "重試 pipeline" :
        "執行 pipeline";
      return (
        <button type="button"
          className="btn btn-primary"
          onClick={() => onRun?.(pipeline.id)}
          aria-label={ariaLabel}
        >
          <span aria-hidden="true"><PlayIcon /></span> {label}
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

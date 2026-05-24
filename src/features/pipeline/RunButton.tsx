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
// 4. disabled 的原因走 aria-label(整段「狀態 — reason」)+ native title(sighted hover tooltip),不重複 aria-describedby
//    — codex 指出 aria-label 已含 reason 時再 aria-describedby 會被 SR 念兩次,反而冗。
// 4a. busy 變體(同步中 / 啟動中)在 button 旁掛 visually-hidden `<span role="status" aria-live="polite">` 發 SR 公告,
//     不在 button 本體加 role=status — 否則同節點 button + status 雙語意,部分 SR 不再唸成按鈕,鍵盤 user 也撞「focusable status」
// 5. icon SVG(PlayIcon / StopIcon / HourglassIcon)用 aria-hidden 包,SR 只念 verb / 狀態文字
// 5a. disabled 變體用 aria-label 取代 visible label 算 accessible name(disabled-empty 兩個 visible span 都 aria-hidden),
//     避免 mobile/desktop display:none 切換造成不同瀏覽器 accessible-name 計算不一致
// 5b. disabled 視覺:加 inline `cursor: not-allowed`(non-owned CSS 無法動 .btn[aria-disabled])避免誤認可點
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

  // phase4-2026-05-23-005 — 改用 tokens.css 全域 .sr-only utility class,
  // 不再 inline CSSProperties。class 內容跟舊 srOnly 同。

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
        <StopIcon aria-hidden="true" /> 停止
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
        className="btn btn-queued"
        onClick={() => onStop?.(pipeline.id)}
        aria-label={ariaLabel}
      >
        <HourglassIcon aria-hidden="true" /> {posLabel} · 取消
      </button>
    );
  }

  // sync 進行中:其餘狀態 RunButton 鎖死,避免 user 誤觸發 runner 撞 worktree
  // 用 aria-disabled + onClick noop 取代 native `disabled`,讓 keyboard / SR 仍可 focus 看到 helper text
  // 同步播報走 button 同層 sibling 的 role=status span,不放 button 上(避免 dual semantics)
  //
  // iter-uiux 2026-05-25 focus-column.sync_active r1:
  // - copy 對齊 sync chip 用語(「助理處理中」)避免 header 一列出現兩種術語(原本「同步中」)。
  //   accessible name 同步改成「助理處理中 — <reason>」。
  // - 加 run-btn-sync-busy class 走 owned focus.css,降低與 sync chip 的視覺重複/避免跟 primary CTA 競爭。
  if (syncActive) {
    const reason = "同步收尾後可執行 ticket";
    return (
      <>
        <button
          type="button"
          className="btn run-btn-sync-busy"
          aria-disabled="true"
          aria-label={`助理處理中 — ${reason}`}
          title={reason}
        >
          <span className="qadr-thinking-dots" aria-hidden="true">
            <span /><span /><span />
          </span>{" "}
          助理處理中
        </button>
        <span className="sr-only" role="status" aria-live="polite">助理處理中</span>
      </>
    );
  }

  // spawning 期間統一顯「啟動中…」覆蓋掉原本的「開始/繼續/重試」狀態
  // 同 syncActive:播報走 sibling role=status span,不放 button 上
  if (
    spawning &&
    (s === "planning" || s === "paused" || s === "failed" || s === "ready" || s === "merged")
  ) {
    const reason = "啟動 runner(約 1-5 秒)";
    return (
      <>
        <button
          type="button"
          className="btn"
          aria-disabled="true"
          aria-label={`啟動中 — ${reason}`}
          title={reason}
        >
          <span className="qadr-thinking-dots" aria-hidden="true">
            <span /><span /><span />
          </span>{" "}
          啟動中
        </button>
        <span className="sr-only" role="status" aria-live="polite">啟動中</span>
      </>
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
        // aria-disabled (而非 native disabled)讓 keyboard 仍可 focus 看 helper text
        return (
          <button
            type="button"
            className={
              "btn run-btn-empty" +
              (s === "merged" ? " run-btn-empty-merged" : "")
            }
            aria-disabled="true"
            aria-label={`無可執行 ticket — ${reason}`}
            title={reason}
            >
            <span className="run-btn-empty-label-full" aria-hidden="true">無可執行 ticket</span>
            <span className="run-btn-empty-label-short" aria-hidden="true">無 ticket</span>
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
          <PlayIcon aria-hidden="true" /> {label}
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

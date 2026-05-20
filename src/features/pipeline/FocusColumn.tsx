import { useState } from "react";
import { createPortal } from "react-dom";
import { CheckIconSm, CloseIcon, PlusIcon, RefreshIcon } from "../../ui/icons";
import { PipelineHistoryDrawer } from "./PipelineHistoryDrawer";
import { STATE_COLOR, TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, fmtElapsed, fmtDuration, normalizeVerdict } from "../../data/pipelines";
import { MODE_LABELS } from "../../api/qa";
import { DiffModal } from "./DiffModal";
import { useFocusPipeline } from "./useFocusPipeline";
import { EmptyTickets } from "./EmptyTickets";
import { OverflowMenu } from "./OverflowMenu";
import { FocusTitle } from "./FocusTitle";
import { ReadyBanner } from "./ReadyBanner";
import type { IterStage, Pipeline, PipelineState, Ticket, TicketStatus } from "../../types/pipeline";
import type { RunSummary } from "../../api/projects";
import "./focus.css";

export { ReadyBanner } from "./ReadyBanner";

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

export function FocusColumn({
  pipeline,
  tick,
  onAddTicket,
  hasActiveDraft = false,
  onRun,
  onStop,
  onDelete,
  onRename,
  onResetPipeline,
  onRevealWorktree,
  onMerge,
  onSync,
  onSyncConfirmAi,
  onSyncCancel,
  onSyncDismiss,
  onToggleAutoMerge,
  existingNames = [],
  onTicketClick,
  projectHash,
  reloadKey = 0,
  queuePosition,
  splittingTicketId,
}: {
  pipeline: Pipeline;
  tick: number;
  reloadKey?: number;
  onAddTicket?: (pipelineId: string) => void;
  hasActiveDraft?: boolean;
  onRun?: (pipelineId: string) => void;
  onStop?: (pipelineId: string) => void;
  onDelete?: (pipelineId: string) => void;
  onRename?: (pipelineId: string, newName: string) => void;
  onResetPipeline?: (pipelineId: string) => void;
  onRevealWorktree?: (pipelineId: string) => void;
  onMerge?: (pipelineId: string) => void;
  onSync?: (pipelineId: string) => void;
  onSyncConfirmAi?: (pipelineId: string) => void;
  onSyncCancel?: (pipelineId: string) => void;
  onSyncDismiss?: (pipelineId: string) => void;
  onToggleAutoMerge?: (pipelineId: string, next: boolean) => void;
  existingNames?: string[];
  onTicketClick?: (ticket: Ticket) => void;
  projectHash?: string;
  queuePosition?: number;
  splittingTicketId?: string | null;
}) {
  const {
    diffStat,
    runs,
    spawning,
    onStart,
    behind,
    totalCost,
    lastRun,
    stateColor,
    stateLabel,
    done,
    total,
    showMergeBanner,
    syncActive,
    lockedByState,
  } = useFocusPipeline({ projectHash, pipeline, reloadKey, onRun });

  // DiffModal 開關 — 由 head 上 chip 點擊觸發,任何 banner 不在的狀態都看得到
  const [diffOpen, setDiffOpen] = useState(false);
  // 「執行紀錄」drawer 開關(pipeline-level,不在 ticket drawer 內)
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <main className="focus" key={pipeline.id}>
      <div className="focus-head fade-up">
        <div className="focus-head-top">
          <FocusTitle
            pipeline={pipeline}
            onRename={onRename}
            existingNames={existingNames}
          />
          <span className="chip mono focus-branch-chip">
            <span className="focus-branch-icon">⎇</span> {pipeline.branch}
          </span>
          <span
            className="chip chip-state"
            style={{
              color: stateColor,
              borderColor: "transparent",
              background: "color-mix(in srgb, " + stateColor + " 14%, transparent)",
            }}
          >
            <span
              className={
                "dot" +
                (pipeline.state === "running" ? " pulse" : "")
              }
              style={{ background: stateColor }}
            />{" "}{stateLabel}
          </span>
          <span className="focus-count mono">
            {done} / {total} done
          </span>
          {runs.length > 0 && (
            <span
              className="chip mono focus-runs-chip"
              title={`累計 ${runs.length} 次執行,共 $${totalCost.toFixed(2)}`}
            >
              {runs.length} run{runs.length === 1 ? "" : "s"} · $
              {totalCost.toFixed(2)}
            </span>
          )}
          {diffStat && (diffStat.files > 0 || diffStat.added > 0 || diffStat.deleted > 0) && projectHash && (
            <button
              type="button"
              className="chip mono focus-diff-chip"
              title={`點擊看完整 diff:${diffStat.files} files,+${diffStat.added} -${diffStat.deleted} vs ${pipeline.baseBranch || "base"}`}
              onClick={() => setDiffOpen(true)}
            >
              <span className="focus-diff-added">+{diffStat.added}</span>
              <span className="focus-diff-sep">·</span>
              <span className="focus-diff-deleted">-{diffStat.deleted}</span>
              <span className="focus-diff-files">{diffStat.files}f</span>
            </button>
          )}
          {diffOpen && projectHash && (
            <DiffModal
              projectHash={projectHash}
              pipelineId={pipeline.id}
              pipelineBranch={pipeline.branch}
              baseBranch={pipeline.baseBranch || "main"}
              onClose={() => setDiffOpen(false)}
            />
          )}
          <SyncStatusBar
            pipeline={pipeline}
            behindFallback={behind}
            pipelineBusy={
              pipeline.state === "running" ||
              pipeline.state === "queued"
            }
            tick={tick}
            onStart={() => onSync?.(pipeline.id)}
            onConfirmAi={() => onSyncConfirmAi?.(pipeline.id)}
            onCancel={() => onSyncCancel?.(pipeline.id)}
            onDismiss={() => onSyncDismiss?.(pipeline.id)}
          />
          {pipeline.syncJob?.state === "conflict_await" && (
            <SyncConflictModal
              pipeline={pipeline}
              onConfirmAi={() => onSyncConfirmAi?.(pipeline.id)}
              onCancel={() => onSyncCancel?.(pipeline.id)}
            />
          )}

          {/* + ticket 視覺強度三檔:
              - 0 ticket / 接續 QA → btn-primary(橘底白字,當下唯一主動作)
              - 有 ticket → btn-accent(橘邊橘字 soft bg,次要 CTA 但仍顯眼)
              RunButton 永遠保留 btn-primary 給「開始運行/繼續」等主動作 */}
          <button
            type="button"
            className={
              "btn focus-add-ticket " +
              (pipeline.tickets.length === 0 || hasActiveDraft ? "btn-primary" : "btn-accent")
            }
            onClick={() => onAddTicket?.(pipeline.id)}
          >
            <PlusIcon /> {hasActiveDraft ? "接續 QA" : "ticket"}
          </button>

          <div className="focus-actions">
            <RunButton
              pipeline={pipeline}
              onRun={onStart}
              onStop={onStop}
              lastRun={lastRun}
              spawning={spawning}
              queuePosition={queuePosition}
              syncActive={syncActive}
            />
            <OverflowMenu
              pipeline={pipeline}
              lockedByState={lockedByState}
              onResetPipeline={onResetPipeline}
              onRevealWorktree={onRevealWorktree}
              onDelete={onDelete}
              onToggleAutoMerge={onToggleAutoMerge}
              onShowHistory={projectHash ? () => setHistoryOpen(true) : undefined}
            />
          </div>
        </div>
        {historyOpen && projectHash && (
          <PipelineHistoryDrawer
            pipelineName={pipeline.name}
            pipelineBranch={pipeline.branch}
            pipelineId={pipeline.id}
            projectHash={projectHash}
            onClose={() => setHistoryOpen(false)}
          />
        )}

        {showMergeBanner && (
          <ReadyBanner
            pipeline={pipeline}
            onMerge={onMerge}
          />
        )}
      </div>

      <div className="focus-list">
        {pipeline.tickets.length === 0 ? (
          <EmptyTickets
            hasActiveDraft={hasActiveDraft}
            onAddTicket={() => onAddTicket?.(pipeline.id)}
          />
        ) : (
          pipeline.tickets
            // mode=sync 是舊版 synthetic ticket(已換成 pipeline.syncJob),歷史資料還可能存在 → 過濾不顯
            .filter((t) => t.mode !== "sync")
            .map((t, i) => (
              <TicketCard
                key={t.id}
                ticket={t}
                tick={tick}
                index={i}
                isSplitting={splittingTicketId === t.id}
                onClick={onTicketClick ? () => onTicketClick(t) : undefined}
              />
            ))
        )}
      </div>
    </main>
  );
}

// Sync 狀態列 — 在 pipeline header 顯示 syncJob 進度;沒 syncJob 且 behind > 0 退回顯示「落後 N · 同步」按鈕。
// 鎖按鈕邏輯:lockedByState(pipeline 在跑)時「同步」按鈕禁用。其他狀態列各自決定按鈕可點性。
function SyncStatusBar({
  pipeline,
  behindFallback,
  pipelineBusy,
  tick,
  onStart,
  onConfirmAi,
  onCancel,
  onDismiss,
}: {
  pipeline: Pipeline;
  behindFallback: number | null;
  pipelineBusy: boolean;
  tick: number;
  onStart: () => void;
  onConfirmAi: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const j = pipeline.syncJob;

  // 沒 syncJob → 顯示 fallback「落後 N · 同步」按鈕(或不顯示)
  if (!j) {
    if (behindFallback === null || behindFallback <= 0) return null;
    return (
      <button
        type="button"
        className="sync-chip"
        title={
          pipelineBusy
            ? `落後 ${pipeline.baseBranch || "base"} ${behindFallback} commit(pipeline 在跑,等停止後或 ready 才能 sync)`
            : `落後 ${pipeline.baseBranch || "base"} ${behindFallback} commit · 點擊先試 git merge,衝突才呼叫 AI`
        }
        disabled={pipelineBusy}
        onClick={onStart}
      >
        <span className="sync-chip-arrow" aria-hidden>⇣</span>
        落後 {behindFallback} · 同步
      </button>
    );
  }

  // 有 syncJob → 依 state 渲染
  if (j.state === "merging") {
    return (
      <span
        className="sync-chip sync-chip-busy"
        title={`git merge ${pipeline.baseBranch || "base"} 進行中(落後 ${j.behindCount} commits)`}
      >
        <span className="qadr-thinking-dots">
          <span /><span /><span />
        </span>
        {" "}同步中… git merge
      </span>
    );
  }

  if (j.state === "conflict_await") {
    const files = j.conflictFiles ?? [];
    const n = files.length;
    const tipPreview = files.slice(0, 8).join("\n");
    const tipMore = files.length > 8 ? `\n…還有 ${files.length - 8} 檔` : "";
    return (
      <span
        className="sync-chip sync-chip-conflict"
        title={`遇衝突 ${n} 檔(落後 ${j.behindCount} commits):\n${tipPreview}${tipMore}\n\n按 ✓ 讓 AI 解 / ✕ 跳過(abort merge)`}
      >
        <span className="sync-chip-arrow" aria-hidden>!</span>
        遇衝突({n} 檔)
        <button
          type="button"
          className="sync-chip-icon sync-chip-primary"
          onClick={onConfirmAi}
          title="讓 AI 解"
          aria-label="讓 AI 解"
        >
          <CheckIconSm />
        </button>
        <button
          type="button"
          className="sync-chip-icon"
          onClick={onCancel}
          title="跳過(abort merge)"
          aria-label="跳過"
        >
          <CloseIcon />
        </button>
      </span>
    );
  }

  if (j.state === "ai_running") {
    const elapsedSec = Math.max(0, Math.round((Date.now() - j.startedAt) / 1000));
    void tick;
    const files = j.conflictFiles ?? [];
    const tipPreview = files.slice(0, 8).join("\n");
    const tipMore = files.length > 8 ? `\n…還有 ${files.length - 8} 檔` : "";
    return (
      <span
        className="sync-chip sync-chip-busy"
        title={`AI 解衝突中 · ${fmtElapsed(elapsedSec)} elapsed\n衝突檔(${files.length}):\n${tipPreview}${tipMore}`}
      >
        <span className="qadr-thinking-dots">
          <span /><span /><span />
        </span>
        {" "}AI 解衝突 · {fmtElapsed(elapsedSec)}
        <button
          type="button"
          className="sync-chip-icon"
          onClick={onCancel}
          title="取消"
          aria-label="取消"
        >
          <CloseIcon />
        </button>
      </span>
    );
  }

  if (j.state === "failed") {
    const files = j.conflictFiles ?? [];
    const tipPreview = files.length > 0 ? `\n衝突檔(${files.length}):\n${files.slice(0, 8).join("\n")}${files.length > 8 ? `\n…還有 ${files.length - 8} 檔` : ""}` : "";
    // reason 可能是 AI raw stdout(幾百字),截短避免 tooltip 爆炸
    const shortReason = (j.reason || "(未知)").slice(0, 200);
    return (
      <span
        className="sync-chip sync-chip-failed"
        title={`同步失敗(落後 ${j.behindCount} commits)\n原因:${shortReason}${tipPreview}`}
      >
        <span className="sync-chip-arrow" aria-hidden>✕</span>
        同步失敗
        <button
          type="button"
          className="sync-chip-icon sync-chip-primary"
          onClick={onStart}
          title="重試"
          aria-label="重試"
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="sync-chip-icon"
          onClick={onDismiss}
          title="關"
          aria-label="關"
        >
          <CloseIcon />
        </button>
      </span>
    );
  }

  // done
  const doneTitle = j.mergeCommit
    ? `同步完成(merge commit ${j.mergeCommit.hash.slice(0, 7)})\n${j.mergeCommit.subject}`
    : j.behindCount > 0
    ? `同步完成(整合 ${j.behindCount} commits)`
    : "已是最新,無需同步";
  return (
    <span className="sync-chip sync-chip-done" title={doneTitle}>
      <span className="sync-chip-arrow" aria-hidden>✓</span>
      已同步
      <button
        type="button"
        className="sync-chip-icon"
        onClick={onDismiss}
        title="關"
        aria-label="關"
      >
        <CloseIcon />
      </button>
    </span>
  );
}

// conflict_await 時跳的對話框,給 user 一個明確「要不要 AI 解」的決策關卡(token 花費前的最後確認)
function SyncConflictModal({
  pipeline,
  onConfirmAi,
  onCancel,
}: {
  pipeline: Pipeline;
  onConfirmAi: () => void;
  onCancel: () => void;
}) {
  const j = pipeline.syncJob;
  if (!j || j.state !== "conflict_await") return null;
  const files = j.conflictFiles ?? [];
  // Portal 到 body 避免被 focus-head 的 transform / overflow 鎖死
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal-card">
        <div className="modal-title">Sync 遇到衝突</div>
        <div className="modal-body">
          <p className="focus-modal-text">
            落後 {j.behindCount} commit,git merge 撞到 <strong>{files.length}</strong> 個檔案衝突:
          </p>
          <ul className="mono focus-modal-files">
            {files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="focus-modal-text--mt">
            要讓 AI 自動解嗎?(隨時可取消)
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消(abort merge)
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirmAi}>
            讓 AI 解 →
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}



export function TicketCard({
  ticket,
  tick,
  index,
  isSplitting = false,
  onClick,
}: {
  ticket: Ticket;
  tick: number;
  index: number;
  isSplitting?: boolean;
  onClick?: () => void;
}) {
  // merge / sync ticket 也跟 iter 一樣有 iter.rounds 結構,渲染走同分支
  const isIter = ticket.mode === "iter" || ticket.mode === "merge" || ticket.mode === "sync";
  // 但 merge / sync 沒真的 critic AI(sub-agent 自己跑驗證自己回 PASS/FAIL),
  // UI 不顯「審核」階段,直接 doer → 結果 兩段
  const hasCritic = ticket.mode === "iter";
  const stageList: IterStage[] = hasCritic ? ["doer", "critic", "✓"] : ["doer", "✓"];
  const isRunning = ticket.status === "running";
  const isPaused = ticket.status === "paused";
  // draft / ready 統一視為「未執行」,共用 is-draft 樣式(opacity 偏淡)
  const isDraft = ticket.status === "draft" || ticket.status === "ready";

  // Round-sum 計時:已完成 round 累加 + in-progress round live(到 Date.now())。
  // 避免 wall-clock 把暫停 / 跨日的閒置時間也算進去(觀感「6 小時還沒跑完」其實多半在等 user)。
  // tick 當 re-render 訊號,使 in-progress round 每秒重算
  void tick;
  let elapsed: number;
  const rs = ticket.iter?.rounds ?? [];
  if (rs.length > 0) {
    // 完成 round 的定義跟下方 IterRounds 渲染一致:endedAt + criticVerdict 都有才算完成
    // (runner 提早寫 endedAt 但 verdict 還空,該 round 仍視為進行中)
    const completedSec = rs.reduce(
      (sum, r) =>
        sum + (r.endedAt && r.criticVerdict && r.startedAt ? Math.max(0, r.endedAt - r.startedAt) : 0),
      0
    ) / 1000;
    const inProg = rs.find((r) => !r.endedAt || !r.criticVerdict);
    const liveSec = isRunning && inProg?.startedAt
      ? Math.max(0, (Date.now() - inProg.startedAt) / 1000)
      : 0;
    elapsed = Math.round(completedSec + liveSec);
  } else {
    const ts = (ticket as { startedAt?: number; endedAt?: number }).startedAt;
    const te = (ticket as { startedAt?: number; endedAt?: number }).endedAt;
    if (typeof ts === "number") {
      const end = isRunning ? Date.now() : (te ?? Date.now());
      elapsed = Math.max(0, Math.round((end - ts) / 1000));
    } else {
      elapsed = ticket.iter?.totalElapsed ?? 0;
    }
  }
  const iterCurrentLabel = ticket.iter ? Math.max(1, ticket.iter.current) : 0;
  const accent = TICKET_STATUS_COLOR[ticket.status] || "var(--draft)";

  return (
    // ticket card 內含 chips + action button,不能用 <button> wrap(invalid HTML),
    // 改 div + role="button" + onKeyDown 已具備鍵盤可達性
    // biome-ignore lint/a11y/noStaticElementInteractions: clickable card with nested buttons
    <div
      className={"ticket"
        + (isDraft ? " is-draft" : "")
        + (isPaused ? " is-paused" : "")
        + (isRunning ? " is-running" : "")
        + (ticket.status === "done" ? " is-done" : "")
        + (ticket.status === "failed" || ticket.status === "failed_iter_limit" || ticket.status === "failed_transient" ? " is-failed" : "")
        + (isSplitting ? " is-splitting" : "")}
      style={{ animationDelay: `${index * 40}ms`, cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <span className="ticket-band" style={{ background: accent }} />

      <div className="ticket-row">
        <span className="ticket-num mono">{String(ticket.n).padStart(2, "0")}</span>
        <div className="ticket-title">{ticket.title}</div>

        <span className={"chip ticket-mode" + (isIter ? " is-iter" : "")}>
          {MODE_LABELS[ticket.mode as "step" | "iter" | "merge" | "sync"] ?? ticket.mode}
        </span>

        {isSplitting ? (
          <span className="chip ticket-splitting">
            <span className="ticket-splitting-spinner" aria-hidden />
            AI 拆分中
          </span>
        ) : (
          <StatusPill status={ticket.status} />
        )}

        {ticket.meta && !isIter && <span className="ticket-meta mono">{ticket.meta}</span>}
      </div>

      {ticket.goal && <div className="ticket-goal">{ticket.goal}</div>}

      {/* iter row / stage chip 只在有跑過(rounds 非空)或執行 / 完成 / 失敗狀態才顯示。
          ready / draft 即使 backend 預建 iter={rounds:[],...} 也不渲染,避免誤判執行中。*/}
      {isIter && ticket.iter &&
        ((ticket.iter.rounds?.length ?? 0) > 0 ||
          ticket.status === "running" ||
          ticket.status === "paused" ||
          ticket.status === "done" ||
          ticket.status === "failed" ||
          ticket.status === "failed_iter_limit" ||
          ticket.status === "failed_transient") && (() => {
        const rounds = ticket.iter.rounds ?? [];
        const inProgress =
          (ticket.status === "running" || ticket.status === "paused") &&
          // stage 不是 ✓:那 round 還沒收尾,顯示 in-progress 列
          ticket.iter.stage !== "✓" &&
          ticket.iter.stage !== "done";
        return (
          <>
            {/* 「完成」收緊定義:endedAt 真有值 + criticVerdict 真有值(runner 偶發提早寫 endedAt 但 verdict 還空,
                舊版只看 endedAt → 那條會被誤算完成又被 inProgress 重複渲染 = #2 雙顯) */}
            {rounds.filter((r) => r.endedAt && r.criticVerdict).map((r) => (
              <div key={r.n} className="ticket-iter ticket-iter-row">
                <span className="iter-round-num mono">#{r.n}</span>
                <IterStages
                  stage="✓"
                  status="done"
                  stages={stageList}
                  lastVerdict={r.criticVerdict}
                />
                <span className="iter-meta mono">
                  {r.startedAt
                    ? fmtElapsed(Math.round((r.endedAt! - r.startedAt) / 1000))
                    : "—"}
                </span>
              </div>
            ))}
            {inProgress && (() => {
              // in-progress round = rounds 內最後一筆「endedAt 沒有 或 verdict 空」(代表 critic 還沒判完),
              // 沒這種 entry 就 fallback ticket.startedAt
              const inProg = rounds.find((r) => !r.endedAt || !r.criticVerdict);
              const completed = rounds.filter((r) => r.endedAt && r.criticVerdict);
              const lastEnded = completed[completed.length - 1]?.endedAt;
              const roundStart = inProg?.startedAt ?? lastEnded ?? (ticket as { startedAt?: number }).startedAt;
              const live = typeof roundStart === "number"
                ? Math.max(0, Math.round((Date.now() - roundStart) / 1000))
                : 0;
              return (
                <div className="ticket-iter ticket-iter-row">
                  <span className="iter-round-num mono">
                    #{inProg?.n ?? (ticket.iter?.current ?? 0) + 1}
                  </span>
                  <IterStages
                    stage={ticket.iter!.stage}
                    status={ticket.status}
                    stages={stageList}
                  />
                  <span className="iter-meta mono">
                    {fmtElapsed(live)}
                  </span>
                </div>
              );
            })()}
            {rounds.length === 0 && !inProgress && (
              // 還沒跑(ready 但 mode=iter/merge/sync 也屬此情形)
              <div className="ticket-iter ticket-iter-row">
                <span className="iter-round-num mono">#1</span>
                <IterStages
                  stage="doer"
                  status={ticket.status}
                  stages={stageList}
                />
              </div>
            )}
            <div className="ticket-iter-summary mono">
              iter <strong>{iterCurrentLabel}</strong> · {fmtElapsed(elapsed)} elapsed
            </div>
          </>
        );
      })()}

      {!isIter && (ticket.status === "running" || ticket.status === "paused" ||
                   ticket.status === "done" || ticket.status === "failed" ||
                   ticket.status === "failed_iter_limit" || ticket.status === "failed_transient") && (
        <div className="ticket-iter ticket-iter-row">
          <span className="iter-round-num mono">#1</span>
          <IterStages
            stage={ticket.status === "done" ? "✓" : "doer"}
            status={ticket.status}
            stages={["doer", "✓"]}
            lastVerdict={
              ticket.status === "done"
                ? "PASS"
                : ticket.status.startsWith("failed")
                ? "FAIL"
                : undefined
            }
          />
          {(() => {
            const sa = ticket.startedAt;
            const ea = ticket.endedAt;
            if (!sa) return null;
            const ms = (ea ?? Date.now()) - sa;
            const live = ticket.status === "running" ? tick : 0;
            return (
              <span className="iter-meta mono">
                {fmtElapsed(Math.round(ms / 1000) + live)}
              </span>
            );
          })()}
        </div>
      )}

      {isRunning && ticket.liveLog && (
        <div className="ticket-livelog mono">
          <span className="livelog-cursor blink">▸</span> {ticket.liveLog}
        </div>
      )}

      {isPaused && ticket.reason && (
        <div className="ticket-paused-actions">
          <span className="paused-reason">{ticket.reason}</span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: TicketStatus }) {
  const c = TICKET_STATUS_COLOR[status] ?? STATE_COLOR[status];
  const label = TICKET_STATUS_LABEL[status] ?? status;
  const isLive = status === "running";
  return (
    <span className="status-pill mono" style={{ color: c }}>
      <span className={"status-pill-dot" + (isLive ? " pulse" : "")} style={{ background: c }} />
      {label}
    </span>
  );
}

const STAGE_LABEL: Record<IterStage, string> = {
  doer: "執行",
  critic: "審核",
  "✓": "結果",
  done: "結果",
};

// 顯示 PASS/FAIL/PARTIAL 簡短版,擺在「結果」階段裡。base 走 normalizeVerdict,
// 這層只負責 UNKNOWN→? 與 PARTIAL→PART 的顯示縮寫。
function fmtVerdict(v: unknown): string {
  const n = normalizeVerdict(v);
  if (n === "UNKNOWN") return "?";
  if (n === "PARTIAL") return "PART";
  return n;
}

function IterStages({
  stage,
  status,
  stages = ["doer", "critic", "✓"],
  lastVerdict,
}: {
  stage: IterStage;
  status: TicketStatus;
  stages?: IterStage[];
  lastVerdict?: unknown;
}) {
  // runner 可能寫不同字面("executing" / "reviewing" / "done" 等),做同義 normalize
  const raw = String(stage);
  const normalized: IterStage =
    raw === "doer" || raw === "critic" || raw === "✓"
      ? (raw as IterStage)
      : raw === "done" || /done|complete|pass|finish|✓/i.test(raw)
      ? "✓"
      : /crit|review|judge|check/i.test(raw)
      ? "critic"
      : /exec|run|do|work/i.test(raw)
      ? "doer"
      : "doer";
  // stages 可能不含 critic(merge / sync 走 ["doer", "✓"]);如果 stage 落不到 stages 裡,fallback 到 doer 避免全顯 ?
  let idx = stages.indexOf(normalized === "done" ? "✓" : normalized);
  if (idx === -1) idx = 0;
  return (
    <div className="iter-stages">
      {stages.map((s, i) => {
        const isPast = i < idx;
        const isCurrent = i === idx;
        const isFuture = i > idx;
        const isResult = s === "✓"; // 結果階段
        // 結果階段的內容:past 用 ✓、current 顯示 verdict(critic 已收尾)、future 用 ?
        let mark: { text: string; cls: string } | null = null;
        if (isPast) {
          mark = { text: "✓", cls: "is-past-mark" };
        } else if (isCurrent) {
          if (isResult) {
            const v = fmtVerdict(lastVerdict);
            mark = { text: v, cls: "is-result-" + v.toLowerCase() };
          } else if (status === "running") {
            mark = { text: "▶", cls: "is-running" };
          } else if (status === "paused") {
            mark = { text: "⏸", cls: "is-paused" };
          }
        } else if (isFuture) {
          mark = { text: "?", cls: "is-future-mark" };
        }
        return (
          <span key={s} style={{ display: "contents" }}>
            <span
              className={
                "iter-stage" +
                (isPast ? " is-past" : "") +
                (isCurrent ? " is-active" : "") +
                (isFuture ? " is-future" : "") +
                (status === "paused" && isCurrent ? " is-paused" : "")
              }
            >
              {STAGE_LABEL[s]}
              {mark && (
                <span className={"iter-stage-mark " + mark.cls} aria-hidden>
                  {mark.text}
                </span>
              )}
            </span>
            {i < stages.length - 1 && <span className="iter-stage-arrow">→</span>}
          </span>
        );
      })}
    </div>
  );
}


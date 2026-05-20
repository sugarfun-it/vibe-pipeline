import { CheckIconSm, CloseIcon, RefreshIcon } from "../../ui/icons";
import { fmtElapsed } from "../../data/pipelines";
import type { Pipeline } from "../../types/pipeline";

// Sync 狀態列 — 在 pipeline header 顯示 syncJob 進度;沒 syncJob 且 behind > 0 退回顯示「落後 N · 同步」按鈕。
// 鎖按鈕邏輯:lockedByState(pipeline 在跑)時「同步」按鈕禁用。其他狀態列各自決定按鈕可點性。
export function SyncStatusBar({
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

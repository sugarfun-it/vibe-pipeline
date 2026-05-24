import { CheckIconSm, CloseIcon, RefreshIcon } from "../../ui/icons";
import { fmtElapsed } from "../../data/pipelines";
import type { Pipeline } from "../../types/pipeline";
import "./syncStatus.css";

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
            ? `落後 ${pipeline.baseBranch || "base"} ${behindFallback} 個 commit(pipeline 在跑,等停止後或 ready 才能同步)`
            : `落後 ${pipeline.baseBranch || "base"} ${behindFallback} 個 commit · 點擊先試合併,衝突才呼叫助理`
        }
        disabled={pipelineBusy}
        onClick={onStart}
      >
        <span className="sync-chip-arrow" aria-hidden>⇣</span>
        落後 {behindFallback} · 同步
      </button>
    );
  }

  // 有 syncJob → 依 state 渲染。busy / 結果類 chip 加 role+aria-live,讓螢幕閱讀器知道狀態改變
  if (j.state === "merging") {
    return (
      <span
        className="sync-chip sync-chip-busy"
        role="status"
        aria-live="polite"
        title={`合併 ${pipeline.baseBranch || "base"} 進行中(落後 ${j.behindCount} 個 commit)`}
      >
        <span className="sync-thinking-dots" aria-hidden>
          <span /><span /><span />
        </span>
        {" "}同步中
      </span>
    );
  }

  if (j.state === "conflict_await") {
    const files = j.conflictFiles ?? [];
    const n = files.length;
    const tipPreview = files.slice(0, 8).join("\n");
    const tipMore = files.length > 8 ? `\n…還有 ${files.length - 8} 個檔案` : "";
    return (
      <span
        className="sync-chip sync-chip-conflict"
        role="status"
        aria-live="polite"
        title={`等待處理衝突 ${n} 個檔案(落後 ${j.behindCount} 個 commit):\n${tipPreview}${tipMore}\n\n按 ✓ 交給助理 / ✕ 取消並中止合併`}
      >
        <span className="sync-chip-arrow" aria-hidden>!</span>
        等待處理衝突（{n} 個檔案）
        <button
          type="button"
          className="sync-chip-icon sync-chip-primary"
          onClick={onConfirmAi}
          title="交給助理解衝突"
          aria-label="交給助理解衝突"
        >
          <CheckIconSm />
        </button>
        <button
          type="button"
          className="sync-chip-icon"
          onClick={onCancel}
          title="取消並中止合併"
          aria-label="取消並中止合併"
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
    const tipMore = files.length > 8 ? `\n…還有 ${files.length - 8} 個檔案` : "";
    return (
      <span
        className="sync-chip sync-chip-busy"
        // role=status 公告「助理處理中」狀態進入(polite);elapsed 秒數放 aria-hidden span,
        // 不會每秒被 SR 反覆讀。aria-label 只描述狀態本身,不帶 ticking number。
        role="status"
        aria-live="polite"
        aria-label="助理處理中"
        title={`助理處理中 · 已歷時 ${fmtElapsed(elapsedSec)}\n衝突檔(${files.length}):\n${tipPreview}${tipMore}`}
      >
        <span className="sync-thinking-dots" aria-hidden>
          <span /><span /><span />
        </span>
        {" "}助理處理中 · <span aria-hidden>{fmtElapsed(elapsedSec)}</span>
        <button
          type="button"
          className="sync-chip-icon"
          onClick={onCancel}
          title="取消"
          aria-label="取消助理處理"
        >
          <CloseIcon />
        </button>
      </span>
    );
  }

  if (j.state === "failed") {
    const files = j.conflictFiles ?? [];
    const tipPreview = files.length > 0 ? `\n衝突檔(${files.length}):\n${files.slice(0, 8).join("\n")}${files.length > 8 ? `\n…還有 ${files.length - 8} 個檔案` : ""}` : "";
    // reason 可能是 AI raw stdout(幾百字),截短避免 tooltip 爆炸
    const shortReason = (j.reason || "(未知)").slice(0, 200);
    return (
      <span
        className="sync-chip sync-chip-failed"
        role="status"
        aria-live="polite"
        title={`同步失敗(落後 ${j.behindCount} 個 commit)\n原因:${shortReason}${tipPreview}`}
      >
        <span className="sync-chip-arrow" aria-hidden>✕</span>
        同步失敗
        <button
          type="button"
          className="sync-chip-icon sync-chip-primary"
          onClick={onStart}
          title="重試同步"
          aria-label="重試同步"
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="sync-chip-icon sync-chip-ghost"
          onClick={onDismiss}
          title="關"
          aria-label="關閉同步失敗提示"
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
    ? `同步完成(整合 ${j.behindCount} 個 commit)`
    : "已是最新,無需同步";
  return (
    <span
      className="sync-chip sync-chip-done"
      role="status"
      aria-live="polite"
      title={doneTitle}
    >
      <span className="sync-chip-arrow" aria-hidden>✓</span>
      已同步
      <button
        type="button"
        className="sync-chip-icon"
        onClick={onDismiss}
        title="關"
        aria-label="關閉同步完成提示"
      >
        <CloseIcon />
      </button>
    </span>
  );
}

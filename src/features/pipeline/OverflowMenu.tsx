import { useEffect, useRef, useState } from "react";
import { FolderIcon, HistoryIcon, RefreshIcon, TrashIcon } from "../../ui/icons";
import { useConfirm } from "../../ui/ConfirmDialog";
import type { Pipeline } from "../../types/pipeline";

// Pipeline 級操作的 overflow menu(原本一字排開太擠,收進 ⋯ 內)。
// 各 action 用 useConfirm() 二次確認(刪除 / 重跑全部);reveal 不需要。
export function OverflowMenu({
  pipeline,
  lockedByState,
  onResetPipeline,
  onRevealWorktree,
  onDelete,
  onToggleAutoMerge,
  onShowHistory,
}: {
  pipeline: Pipeline;
  lockedByState: boolean;
  onResetPipeline?: (id: string) => void;
  onRevealWorktree?: (id: string) => void;
  onDelete?: (id: string) => void;
  onToggleAutoMerge?: (id: string, next: boolean) => void;
  onShowHistory?: () => void;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 沒任何 action 可做就不顯示
  if (!onResetPipeline && !onRevealWorktree && !onDelete && !onToggleAutoMerge && !onShowHistory) return null;

  return (
    <div ref={wrapRef} className="focus-overflow">
      <button type="button"
        className="btn"
        onClick={() => setOpen((o) => !o)}
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="focus-overflow-menu">
          {onToggleAutoMerge && (
            <MenuItem
              icon={<span style={{ color: pipeline.autoMerge ? "var(--done)" : "var(--fg-faint)" }}>{pipeline.autoMerge ? "●" : "○"}</span>}
              label="自動合併"
              hint={lockedByState ? "執行中無法操作" : pipeline.autoMerge ? "已開啟" : "未開啟"}
              disabled={lockedByState}
              onClick={() => {
                onToggleAutoMerge(pipeline.id, !pipeline.autoMerge);
              }}
            />
          )}
          {onShowHistory && (
            <MenuItem
              icon={<HistoryIcon />}
              label="執行紀錄"
              hint=""
              onClick={() => {
                setOpen(false);
                onShowHistory();
              }}
            />
          )}
          {onRevealWorktree && (
            <MenuItem
              icon={<FolderIcon />}
              label="開啟 worktree"
              hint=""
              onClick={() => {
                setOpen(false);
                onRevealWorktree(pipeline.id);
              }}
            />
          )}
          {onResetPipeline && (
            <MenuItem
              icon={<RefreshIcon />}
              label="重置 pipeline"
              hint={lockedByState ? "執行中無法操作" : ""}
              disabled={lockedByState}
              danger
              onClick={async () => {
                setOpen(false);
                const isMerged = pipeline.state === "merged";
                const ndone = pipeline.tickets.filter((t) => t.status === "done").length;
                const nfail = pipeline.tickets.filter((t) =>
                  t.status === "failed" ||
                  t.status === "failed_iter_limit" ||
                  t.status === "failed_transient"
                ).length;
                const ok = await confirm({
                  title: `重置 pipeline "${pipeline.name}"?`,
                  warning: isMerged
                    ? undefined
                    : `未 merge 進 base 的 commit 會永久丟失(branch 會被刪)`,
                  description:
                    `會做三件事:\n` +
                    ` · 刪 worktree dir(~/.vibe-pipeline/worktrees/<projHash>/${pipeline.id}/)\n` +
                    ` · 刪 branch(pipeline/${pipeline.name})— 下次 Run 從 base 重建,不會落後\n` +
                    ` · tickets 狀態回 draft:${ndone} done + ${nfail} failed\n\n` +
                    (isMerged
                      ? `已 merged,branch 的內容都在 base 上,刪 branch 無風險。`
                      : `要保留 branch 上的 commit 請先 merge 或 cherry-pick → 再重置。`),
                  confirmLabel: "重置",
                  danger: true,
                });
                if (ok) onResetPipeline(pipeline.id);
              }}
            />
          )}
          {onDelete && (
            <MenuItem
              icon={<TrashIcon />}
              label="刪除 pipeline"
              hint={lockedByState ? "執行中無法操作" : ""}
              disabled={lockedByState}
              danger
              onClick={async () => {
                setOpen(false);
                const isMerged = pipeline.state === "merged";
                const ok = await confirm({
                  title: `刪除 pipeline "${pipeline.name}"?`,
                  warning: isMerged
                    ? undefined
                    : `此 pipeline 還沒 merge 進 base — 未 commit 的變動會永久丟失`,
                  description: isMerged
                    ? `已 merged,刪除無風險。\n` +
                      `會清掉 pipeline.json + 對應 worktree (~/.vibe-pipeline/worktrees/...)。\n` +
                      `branch 跟已 commit 的內容仍在 base 上看得到。`
                    : `會清掉 pipeline.json + 對應 worktree。\n` +
                      `已 commit 的 ticket commit 留在 branch 內(手動 git checkout 該 branch 救得回,但 vibe-pipeline UI 看不到)。\n` +
                      `要保留請先 merge 或備份 → 再刪。`,
                  confirmLabel: isMerged ? "刪除" : "強制刪除",
                  danger: true,
                });
                if (ok) onDelete(pipeline.id);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  disabled,
  danger,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button"
      role="menuitem"
      className={"pipeline-overflow-menu-item focus-overflow-item" + (danger ? " is-danger" : "")}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="focus-overflow-item-icon">{icon}</span>
      <span className="focus-overflow-item-label">{label}</span>
      {hint && (
        <span className="mono focus-overflow-item-hint">{hint}</span>
      )}
    </button>
  );
}

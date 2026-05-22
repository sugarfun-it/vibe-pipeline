import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DotsHorizontalIcon, FolderIcon, HistoryIcon, RefreshIcon, TrashIcon } from "../../ui/icons";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // 量測 trigger 位置 → 算出 menu 在 viewport 內的最終座標(top + right-align)。
  // 在 viewport 邊緣時改向上開,避免被 viewport / 父 overflow 截掉。
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    function reposition() {
      const trig = triggerRef.current;
      if (!trig) return;
      const r = trig.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      // menu 高度若 ≤ below,往下開;否則往上開(top = r.top - menuH - 4)。
      const openUp = menuH > below && above > below;
      const top = openUp ? Math.max(8, r.top - menuH - 4) : r.bottom + 4;
      // right-align:menu 右邊對齊 trigger 右邊
      setPos({ top, left: r.right, width: r.width });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  // 開啟時 focus 第一個可用 menu item;close 時 focus 回 trigger。
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role^="menuitem"]:not([disabled])'
      );
      first?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!menuRef.current) return;
      const items = Array.from(
        menuRef.current.querySelectorAll<HTMLButtonElement>(
          '[role^="menuitem"]:not([disabled])'
        )
      );
      if (items.length === 0) return;
      const cur = document.activeElement as HTMLElement | null;
      const idx = cur ? items.indexOf(cur as HTMLButtonElement) : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
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

  const hasDangerSection = !!(onResetPipeline || onDelete);
  const hasSafeSection = !!(onToggleAutoMerge || onShowHistory || onRevealWorktree);

  return (
    <div ref={wrapRef} className="focus-overflow">
      <button type="button"
        ref={triggerRef}
        className="btn"
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (!next) triggerRef.current?.focus();
            return next;
          });
        }}
        title="更多操作"
        aria-label="更多 pipeline 操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DotsHorizontalIcon />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`pipeline ${pipeline.name} 操作`}
          className="focus-overflow-menu"
          style={pos ? {
            position: "fixed",
            top: pos.top,
            // right-align:把 left 算成 r.right - menuWidth,但 menuWidth 動態 → 用 transform translateX(-100%) + left = r.right
            left: pos.left,
            transform: "translateX(-100%)",
          } : { position: "fixed", visibility: "hidden" }}
        >
          {onToggleAutoMerge && (
            <MenuItem
              role="menuitemcheckbox"
              ariaChecked={!!pipeline.autoMerge}
              icon={<span aria-hidden style={{ color: pipeline.autoMerge ? "var(--done)" : "var(--fg-faint)" }}>{pipeline.autoMerge ? "●" : "○"}</span>}
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
                triggerRef.current?.focus();
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
                triggerRef.current?.focus();
                onRevealWorktree(pipeline.id);
              }}
            />
          )}
          {hasSafeSection && hasDangerSection && (
            <div
              role="separator"
              aria-orientation="horizontal"
              className="focus-overflow-sep"
              style={{
                height: 1,
                background: "var(--line)",
                margin: "4px 6px",
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
                triggerRef.current?.focus();
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
                triggerRef.current?.focus();
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
        </div>,
        document.body,
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
  role = "menuitem",
  ariaChecked,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  role?: "menuitem" | "menuitemcheckbox";
  ariaChecked?: boolean;
}) {
  return (
    <button type="button"
      role={role}
      aria-checked={role === "menuitemcheckbox" ? !!ariaChecked : undefined}
      aria-disabled={disabled || undefined}
      title={disabled ? hint || "目前無法操作" : undefined}
      className={
        "pipeline-overflow-menu-item focus-overflow-item" +
        (danger ? " is-danger" : "") +
        (disabled ? " is-disabled" : "")
      }
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

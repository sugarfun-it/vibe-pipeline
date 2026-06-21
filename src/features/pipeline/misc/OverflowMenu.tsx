import { useRef, useState } from "react";
import { DotsHorizontalIcon, FolderIcon, HistoryIcon, RefreshIcon, TrashIcon } from "../../../ui/icons";
import { useConfirm } from "../../../ui/ConfirmDialog";
import { Popover } from "../../../ui/Popover";
import type { Pipeline } from "../../../../shared/types";
import { isLocalHost } from "../../../lib/isLocalHost";

// Pipeline 級操作的 overflow menu(原本一字排開太擠,收進 ⋯ 內)。
// 各 action 用 useConfirm() 二次確認(刪除 / 重跑全部);reveal 不需要。
// anchor 量測 / click-outside / esc / roving focus / viewport flip 全交給 <Popover>。
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
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 沒任何 action 可做就不顯示
  if (!onResetPipeline && !onRevealWorktree && !onDelete && !onToggleAutoMerge && !onShowHistory) return null;

  const hasDangerSection = !!(onResetPipeline || onDelete);
  const hasSafeSection = !!(onToggleAutoMerge || onShowHistory || onRevealWorktree);

  return (
    <div className="focus-overflow">
      <button type="button"
        ref={triggerRef}
        className="btn"
        onClick={() => setOpen((o) => !o)}
        title="更多操作"
        aria-label="更多 pipeline 操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DotsHorizontalIcon />
      </button>
      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        role="menu"
        ariaLabel={`pipeline ${pipeline.name} 操作`}
        className="menu-surface focus-overflow-menu"
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
                onShowHistory();
              }}
            />
          )}
          {onRevealWorktree && isLocalHost() && (() => {
            // 用 backend 提供的 hasWorktree(existsSync 算出來)當真實 source。
            // 涵蓋 planning(沒建)、merged 自動 cleanup、外部手動 rm、delete-merged bulk 等
            // state 跟 fs 不一致情境。沒帶該欄位(舊 backend / 載入中)就 fallback 用 state heuristic。
            const hasWorktree = typeof pipeline.hasWorktree === "boolean"
              ? pipeline.hasWorktree
              : pipeline.state !== "planning" && pipeline.state !== "merged";
            const hint = hasWorktree
              ? ""
              : pipeline.state === "planning"
              ? "未建立"
              : pipeline.state === "merged"
              ? "已合併"
              : "已清除";
            return (
              <MenuItem
                icon={<FolderIcon />}
                label="開啟 worktree"
                hint={hint}
                disabled={!hasWorktree}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  onRevealWorktree(pipeline.id);
                }}
              />
            );
          })()}
          {hasSafeSection && hasDangerSection && (
            <div
              role="separator"
              aria-orientation="horizontal"
              className="focus-overflow-sep"
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
                  descriptionRich: (
                    <>
                      <p>會做三件事:</p>
                      <ul>
                        <li>刪 worktree dir(<code>{`~/.vibe-pipeline/worktrees/<projHash>/${pipeline.id}/`}</code>)</li>
                        <li>刪 branch(<code>{`pipeline/${pipeline.name}`}</code>)— 下次 Run 從 base 重建,不會落後</li>
                        <li>tickets 狀態回 draft:{ndone} done + {nfail} failed</li>
                      </ul>
                      <p>
                        {isMerged
                          ? "已 merged,branch 的內容都在 base 上,刪 branch 無風險。"
                          : "要保留 branch 上的 commit 請先 merge 或 cherry-pick → 再重置。"}
                      </p>
                    </>
                  ),
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
                // iter-uiux-2026-05-24 confirm-dialog.danger r1 danger-i18n-punct + danger-warning-tighten —
                // 警示句改 consequence-first(關鍵後果先講),body 統一全形括號 / 逗號 / 頓號,
                // 拿掉重複的「commit / branch」字眼讓 mobile 換行不糊。
                const ok = await confirm({
                  title: `刪除 pipeline "${pipeline.name}"?`,
                  warning: isMerged
                    ? undefined
                    : `未 merge 進 base：未 commit 的變動會永久丟失。`,
                  descriptionRich: isMerged ? (
                    <>
                      <p><strong>已 merged，刪除無風險。</strong></p>
                      <p>會清掉 pipeline.json + 對應 worktree（<code>~/.vibe-pipeline/worktrees/...</code>）。</p>
                      <p>branch 跟已 commit 的內容仍在 base 上看得到。</p>
                    </>
                  ) : (
                    <>
                      <p>會清掉 pipeline.json + 對應 worktree。</p>
                      <p>已提交的 ticket commit 仍留在 branch 內（可手動 <code>git checkout</code> 該 branch 取回，但 vibe-pipeline UI 不會顯示）。</p>
                      <p>要保留請先 merge 或備份 → 再刪。</p>
                    </>
                  ),
                  confirmLabel: isMerged ? "刪除" : "強制刪除",
                  danger: true,
                });
                if (ok) onDelete(pipeline.id);
              }}
            />
          )}
      </Popover>
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

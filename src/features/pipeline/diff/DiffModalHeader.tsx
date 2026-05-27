import type { FullDiff } from "../../../api";
import { ArrowRightIcon, CloseIcon } from "../../../ui/icons";

type DiffModalHeaderProps = {
  titleId: string;
  branchId: string;
  pipelineBranch: string;
  baseBranch: string;
  diff: FullDiff | null;
  addedTotal: number;
  deletedTotal: number;
  copied: boolean;
  onCopyRaw: () => void;
  onClose: () => void;
};

export function DiffModalHeader({
  titleId,
  branchId,
  pipelineBranch,
  baseBranch,
  diff,
  addedTotal,
  deletedTotal,
  copied,
  onCopyRaw,
  onClose,
}: DiffModalHeaderProps) {
  return (
    <div className="drawer-head diff-modal-head">
      <div className="diff-modal-title">
        <span id={titleId} className="diff-modal-title-label">差異總覽</span>
        {/* aria-label 把 arrow icon 的「對比」語意補回來(SR 不讀 aria-hidden 的 icon)
            + 把 base branch 段獨立 wrap 給 CSS 用,讓 mobile branch 截斷時 base 永遠看得到(rwd-008 / copy-002 / a11y-title-001)。 */}
        <span
          id={branchId}
          className="diff-modal-branch mono"
          title={`${pipelineBranch} → ${baseBranch}`}
          aria-label={`${pipelineBranch} 對比 ${baseBranch}`}
        >
          <span className="diff-modal-branch-head">{pipelineBranch}</span>
          <span aria-hidden className="diff-modal-branch-arrow"><ArrowRightIcon /></span>
          <span className="diff-modal-branch-base">{baseBranch}</span>
        </span>
      </div>
      {diff && (
        <span
          className="diff-modal-summary mono"
          aria-label={`共 ${diff.files.length} 個檔案,新增 ${addedTotal} 行,刪除 ${deletedTotal} 行`}
        >
          <span>{diff.files.length} 個檔案</span>
          <span aria-hidden className="diff-modal-summary-sep">·</span>
          <span className="diff-modal-stat-added">+{addedTotal}</span>
          <span className="diff-modal-stat-deleted">−{deletedTotal}</span>
        </span>
      )}
      <div className="diff-modal-actions">
        {diff && diff.files.length > 0 && (
          <button
            type="button"
            className={"diff-modal-copy" + (copied ? " is-copied" : "")}
            onClick={onCopyRaw}
            title="複製原始 diff"
            /* aria-label 維持不變(不在 copied 時換字),避免「focused button 名字突然變」的 SR 噪音;
               「已複製」公告交給外部 sr-only role=status region(a11y-002 copied) */
            aria-label="複製原始差異到剪貼簿"
          >
            {copied ? "已複製" : "複製差異"}
          </button>
        )}
        <button
          type="button"
          className="drawer-close diff-modal-x"
          onClick={onClose}
          title="關閉 (Esc)"
          aria-label="關閉差異視窗 (Esc)"
        >
          <CloseIcon aria-hidden />
        </button>
      </div>
    </div>
  );
}

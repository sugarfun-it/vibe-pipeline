import { useState } from "react";
import { PlusIcon } from "../../ui/icons";
import { PipelineHistoryDrawer } from "./PipelineHistoryDrawer";
import { FocusTitle } from "./FocusTitle";
import { OverflowMenu } from "./OverflowMenu";
import { ReadyBanner } from "./ReadyBanner";
import { RunButton } from "./RunButton";
import { SyncStatusBar } from "./SyncStatusBar";
import { SyncConflictModal } from "./SyncConflictModal";
import { FocusDiffChip } from "./FocusDiffChip";
import type { Pipeline } from "../../types/pipeline";
import type { DiffStat, RunSummary } from "../../api/projects";

export function FocusHeader({
  pipeline,
  tick,
  hasActiveDraft,
  existingNames,
  projectHash,
  queuePosition,
  // hook-derived
  diffStat,
  runs,
  spawning,
  behind,
  totalCost,
  stateColor,
  stateLabel,
  done,
  total,
  showMergeBanner,
  syncActive,
  lockedByState,
  onStart,
  // handlers from FocusColumn
  onAddTicket,
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
}: {
  pipeline: Pipeline;
  tick: number;
  hasActiveDraft: boolean;
  existingNames: string[];
  projectHash?: string;
  queuePosition?: number;
  diffStat: DiffStat | null;
  runs: RunSummary[];
  spawning: boolean;
  behind: number | null;
  totalCost: number;
  stateColor: string;
  stateLabel: string;
  done: number;
  total: number;
  showMergeBanner: boolean;
  syncActive: boolean;
  lockedByState: boolean;
  onStart: (pipelineId: string) => void;
  onAddTicket?: (pipelineId: string) => void;
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
}) {
  // 「執行紀錄」drawer 開關(pipeline-level,不在 ticket drawer 內)
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="focus-head fade-up">
      <div className="focus-head-top">
        {/* Row 1 — title + rename + overflow.RunButton / branch chip / CTA 都不在這列。
            Row 1 永遠保持單行,不會被 RunButton 撐爆。 */}
        <div className="focus-head-title-row">
          <FocusTitle
            pipeline={pipeline}
            onRename={onRename}
            existingNames={existingNames}
          />
          <div className="focus-head-title-spacer" />
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
        {/* Row 2 — meta chips + branch + sync + spacer + primary CTAs(+ticket / Run)。
            Mobile 透過 CSS 把 branch chip / disabled RunButton 弱化(text-only)。 */}
        <div className="focus-head-meta-row">
          <span
            className="chip chip-state"
            style={{
              color: "var(--fg)",
              borderColor: "transparent",
              background: "color-mix(in srgb, " + stateColor + " 14%, transparent)",
            }}
            aria-label={`pipeline 狀態:${stateLabel}`}
          >
            <span
              aria-hidden
              className={
                "dot" +
                (pipeline.state === "running" ? " pulse" : "")
              }
              style={{ background: stateColor }}
            />{" "}{stateLabel}
          </span>
          <span className="focus-count mono" title={`完成 ${done} / 全部 ${total}`}>
            {done}/{total} 完成
          </span>
          {runs.length > 0 && (
            <span
              className="chip mono focus-runs-chip"
              title={`累計 ${runs.length} 次執行,共 $${totalCost.toFixed(2)}`}
            >
              {runs.length} 次執行 · ${totalCost.toFixed(2)}
            </span>
          )}
{diffStat && (diffStat.files > 0 || diffStat.added > 0 || diffStat.deleted > 0) && projectHash && (
            <FocusDiffChip
              pipeline={pipeline}
              projectHash={projectHash}
              diffStat={diffStat}
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
          <div className="focus-head-meta-spacer" />
          <div className="focus-actions" data-pipeline-state={pipeline.state} data-show-merge-banner={showMergeBanner ? "1" : "0"}>
            <span className="focus-run-wrap" data-pipeline-state={pipeline.state}>
              <RunButton
                pipeline={pipeline}
                onRun={onStart}
                onStop={onStop}
                spawning={spawning}
                queuePosition={queuePosition}
                syncActive={syncActive}
              />
            </span>
            {/* + ticket 視覺強度三檔:
                - 0 ticket / 接續 QA → btn-primary(橘底白字,當下唯一主動作)
                - 有 ticket → btn-accent(橘邊橘字 soft bg,次要 CTA 但仍顯眼) */}
            <button
              type="button"
              className={
                "btn focus-add-ticket " +
                (pipeline.tickets.length === 0 || hasActiveDraft ? "btn-primary" : "btn-accent")
              }
              onClick={() => onAddTicket?.(pipeline.id)}
            >
              <PlusIcon /> {hasActiveDraft ? "接續 QA" : "新增 ticket"}
            </button>
          </div>
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
  );
}

import { useFocusPipeline } from "./useFocusPipeline";
import { FocusHeader } from "./FocusHeader";
import { FocusTicketList } from "./FocusTicketList";
import type { Pipeline, Ticket } from "../../../../shared/types";
import "./focus.css";

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
    stateLabel,
    done,
    total,
    showMergeBanner,
    syncActive,
    lockedByState,
  } = useFocusPipeline({ projectHash, pipeline, reloadKey, onRun });

  return (
    <main className="focus" key={pipeline.id}>
      <FocusHeader
        pipeline={pipeline}
        tick={tick}
        hasActiveDraft={hasActiveDraft}
        existingNames={existingNames}
        projectHash={projectHash}
        queuePosition={queuePosition}
        diffStat={diffStat}
        runs={runs}
        spawning={spawning}
        behind={behind}
        totalCost={totalCost}
        stateLabel={stateLabel}
        done={done}
        total={total}
        showMergeBanner={showMergeBanner}
        syncActive={syncActive}
        lockedByState={lockedByState}
        onStart={onStart}
        onAddTicket={onAddTicket}
        onStop={onStop}
        onDelete={onDelete}
        onRename={onRename}
        onResetPipeline={onResetPipeline}
        onRevealWorktree={onRevealWorktree}
        onMerge={onMerge}
        onSync={onSync}
        onSyncConfirmAi={onSyncConfirmAi}
        onSyncCancel={onSyncCancel}
        onSyncDismiss={onSyncDismiss}
        onToggleAutoMerge={onToggleAutoMerge}
      />
      <FocusTicketList
        pipeline={pipeline}
        tick={tick}
        hasActiveDraft={hasActiveDraft}
        onAddTicket={onAddTicket}
        onTicketClick={onTicketClick}
        splittingTicketId={splittingTicketId}
      />
    </main>
  );
}

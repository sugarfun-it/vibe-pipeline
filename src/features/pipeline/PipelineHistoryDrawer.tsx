import { useEffect, useId } from "react";
import "../../styles/drawer.css";
import "./ticketDrawer.css";
import { RunHistory } from "./RunHistory";
import { AuditTimeline } from "./AuditTimeline";
import { Overlay } from "../../ui/Overlay";

// Pipeline-level 執行紀錄 drawer。從 pipeline header OverflowMenu 開,
// 顯示該 pipeline 跑過的所有 runner spawn(cost / duration / result / token)。
// 跟 TicketDrawer 用同一套 .drawer-stage / .drawer 樣式;portal 到 body 避免 stacking context 雷
export function PipelineHistoryDrawer({
  pipelineName,
  pipelineBranch,
  pipelineId,
  projectHash,
  onClose,
}: {
  pipelineName: string;
  pipelineBranch: string;
  pipelineId: string;
  projectHash: string;
  onClose: () => void;
}) {
  const titleId = useId();

  // Body scroll lock(Overlay 不做,因為各 overlay 對 body 鎖法可能差異 — 例如 modal 不一定要鎖)
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <Overlay
      role="dialog"
      onRequestClose={onClose}
      labelledBy={titleId}
      portal
      stageClassName="tdrw-stage"
      surfaceClassName="tdrw-drawer"
    >
      <div className="drawer-head">
        <div className="drawer-crumb">
          <span className="mono">{pipelineName}</span>
          <span className="drawer-crumb-spacer" />
          <button
            type="button"
            className="create-x"
            onClick={onClose}
            title="關閉執行紀錄 (Esc)"
            aria-label="關閉執行紀錄"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="drawer-titlerow">
          <div className="drawer-title" id={titleId}>執行紀錄</div>
        </div>
        <div className="drawer-meta mono">
          {pipelineBranch} · 此 Pipeline 的所有 Runner 執行紀錄
        </div>
      </div>
      <div className="drawer-body">
        {/* RunHistory(本體執行紀錄)在前,AuditTimeline(狀態變動歷史,可摺疊)在後,
            對齊 drawer 標題「執行紀錄」承諾;狀態變動歷史是輔助,放下面 */}
        <RunHistory projectHash={projectHash} pipelineId={pipelineId} />
        <AuditTimeline projectHash={projectHash} pipelineId={pipelineId} />
      </div>
    </Overlay>
  );
}

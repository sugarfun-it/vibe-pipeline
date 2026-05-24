import { useEffect, useId, useState } from "react";
import "../../styles/drawer.css";
import "./ticketDrawer.css";
import { RunHistory } from "./RunHistory";
import { AuditTimeline } from "./AuditTimeline";
import { Overlay } from "../../ui/Overlay";
import * as api from "../../api/projects";
import type { AuditEntry } from "../../api/projects";

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
  const descId = useId();
  // history-audit-010 round 5 (2026-05-24):drawer 頂部小 summary 顯示「目前狀態 + 最後一次變動」,
  //   讓 user 不必往下捲就知道「為何 paused / 為何 ready / 為何 merged」。
  //   取 audit 最新一筆 entry(reverse-chrono → arr[0]),非阻塞,失敗安靜降級。
  const [topAudit, setTopAudit] = useState<AuditEntry | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getPipelineAudit(projectHash, pipelineId, 1)
      .then((arr) => {
        if (cancelled) return;
        setTopAudit(arr[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectHash, pipelineId]);

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
      describedBy={descId}
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
        {/* history-empty-004 / audit-current-run-empty-conflict (2026-05-24):
            原本 meta 只標 branch + 「全部 Runner」,user 無法分辨 drawer 內
            上下兩段(RunHistory / AuditTimeline)。改成 2 行:
              line 1 = branch(mono)
              line 2 = scope hint(中文化:「執行紀錄 · 狀態變動歷史」)
            history-empty-012 round 3:從「Runner 執行 + 狀態變動歷史」改純中文,
              避免英文 noun 跟中文 UI 混雜;round 3 也把 inline style 移到 .pipeline-history-scope。 */}
        <div className="drawer-meta mono" id={descId}>
          {pipelineBranch}
        </div>
        <div className="drawer-meta pipeline-history-scope">
          執行紀錄 · 狀態變動歷史
        </div>
      </div>
      <div className="drawer-body">
        {/* history-audit-010 round 5 (2026-05-24):drawer body 最上方 1 行 summary,
            顯示 pipeline 最新一次狀態變動。user 不必往下捲、不必展開 AuditTimeline,
            就能回答「為何現在是這個狀態」。沒 audit 時(剛建好 pipeline)不渲染。 */}
        {topAudit && (
          <div className="pipeline-history-top-summary" role="status">
            <span className="pipeline-history-top-summary-label">目前狀態</span>
            <span className="pipeline-history-top-summary-state mono">{topAudit.to}</span>
            <span className="pipeline-history-top-summary-reason">
              <span className="pipeline-history-top-summary-sep">·</span>
              最後一次變動於 <span className="mono">{fmtTopAudit(topAudit.ts)}</span>,來自 {topAuditSourceLabel(topAudit)}
            </span>
          </div>
        )}
        {/* RunHistory(本體執行紀錄)在前,AuditTimeline(狀態變動歷史,可摺疊)在後,
            對齊 drawer 標題「執行紀錄」承諾;狀態變動歷史是輔助,放下面。
            history-empty-010 (2026-05-24):RunHistory 在 empty 狀態時自帶 onClose
            讓 CTA「關閉並回 pipeline 執行」可從 empty 內 row 觸發,不再死路。 */}
        <RunHistory
          projectHash={projectHash}
          pipelineId={pipelineId}
          onCloseDrawer={onClose}
        />
        <AuditTimeline projectHash={projectHash} pipelineId={pipelineId} />
      </div>
    </Overlay>
  );
}

// 短格式 — 跟 drawer 既有 mono 樣式對齊;不重複造輪
function fmtTopAudit(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// minimal 中譯 — AuditTimeline 內有完整 SOURCE_LABEL,本 1-line summary 只用 5 種主要 source
const TOP_AUDIT_SOURCE: Record<string, string> = {
  "user-action": "使用者操作",
  "api-handler-explicit": "API 明確指定",
  "runner-self-detected": "Runner 自動偵測",
  "orchestrator.spawnDirect": "Orchestrator 啟動",
  "ticketWatcher-detected": "Ticket Watcher 偵測",
};
function topAuditSourceLabel(e: AuditEntry): string {
  const src = TOP_AUDIT_SOURCE[e.source] ?? e.source;
  return e.sourceDetail ? `${src}(${e.sourceDetail})` : src;
}

import { useEffect, useId, useState } from "react";
import "../../../styles/drawer.css";
import "../ticket/ticket.css";
import { RunHistory } from "./RunHistory";
import { AuditTimeline } from "../diff/AuditTimeline";
import { Overlay } from "../../../ui/Overlay";
import { formatDateTime } from "../../../lib/format";
import * as api from "../../../api";
import type { AuditEntry } from "../../../api";

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

  // Body scroll lock 由 Overlay primitive 統一管(ref-counted),不再各自實作

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
            className="drawer-close create-x"
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
        {/* HD-EMPTY-006 round 1 (2026-05-25):scope hint「執行紀錄 · 狀態變動歷史」對 empty 與
            non-empty 都是冗述,跟標題「執行紀錄」重複;移除,讓 head 更乾淨。branch chip 仍保留。 */}
        <div className="drawer-meta mono" id={descId}>
          {pipelineBranch}
        </div>
      </div>
      <div className="drawer-body">
        {/* history-audit-010 round 5 (2026-05-24) / HD-EMPTY-001/004/007 round 1 (2026-05-25):
            drawer body 最上方 1 行 summary,顯示 pipeline 最新一次狀態變動。
            r1:raw enum「planning」→ zh 標籤「規劃中」;未知 audit source 用通用中文 fallback;
            timestamp aria-label 補完整年月時區;static summary 不再 role=status(避免 SR 重複播報)。 */}
        {topAudit && (() => {
          // HD-EMPTY-009 / 010 round 2 (2026-05-25):
          //   r1 用 inline 「·」 separator + 半形逗號 把「狀態」與「最後變動」串成 1 行,
          //   在 mobile 窄寬下 wrap 後「·」會出現在第二行行首像 stray bullet,
          //   讀感 = 條列殘留。r2 改:第一行只放「目前狀態 + 中文標籤」(完整一行不 wrap),
          //   第二行另起「最後變動於 <ts> · 來源：<source>」用全形冒號,
          //   半形逗號改 inline · separator,desktop / mobile 都不會把 punctuation 推到行首。
          const s = topAuditSourceLabel(topAudit);
          return (
            <div className="pipeline-history-top-summary">
              <div className="pipeline-history-top-summary-line">
                <span className="pipeline-history-top-summary-label">目前狀態</span>
                <span className="pipeline-history-top-summary-state">{stateLabel(topAudit.to)}</span>
              </div>
              <div className="pipeline-history-top-summary-line pipeline-history-top-summary-line-meta">
                {/* HD-CODEX-003 round 1 (2026-05-25):flex gap 在兩個 span 中間多塞 8px,
                    讓「來源:」 與「系統」之間出現視覺空白(像「來源: 系統」),
                    把這兩 span 併到同一 span,gap 不再插入,觀感緊湊。 */}
                <span>最後變動於 </span>
                <span className="mono" title={formatDateTime(topAudit.ts, "full-tz")}>{formatDateTime(topAudit.ts, "compact")}</span>
                <span className="pipeline-history-top-summary-sep" aria-hidden> · </span>
                <span title={s.rawTitle}>來源:{s.text}</span>
              </div>
            </div>
          );
        })()}
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

// HD-EMPTY-001 round 1 (2026-05-25):state enum → zh user-facing 標籤,未知保留原 enum
const STATE_LABEL_TOP: Record<string, string> = {
  planning: "規劃中",
  queued: "排隊中",
  running: "執行中",
  paused: "已暫停",
  ready: "可合併",
  failed: "失敗",
  merged: "已合併",
};
function stateLabel(s: string): string {
  return STATE_LABEL_TOP[s.toLowerCase()] ?? s;
}
// minimal 中譯 — AuditTimeline 內有完整 SOURCE_LABEL,本 1-line summary 只用 5 種主要 source
// HD-EMPTY-001 round 1 (2026-05-25):補 api-create-pipeline / api-handler 等 backend 常 emit 的 source,
//   未知值 fallback「系統」(不再 dump raw debug 字串到 user-facing summary)
const TOP_AUDIT_SOURCE: Record<string, string> = {
  "user-action": "使用者操作",
  "api-handler-explicit": "API 明確指定",
  "api-create-pipeline": "建立 pipeline",
  "runner-self-detected": "Runner 自動偵測",
  "orchestrator.spawnDirect": "Orchestrator 啟動",
  "ticketWatcher-detected": "Ticket Watcher 偵測",
};
// HD-EMPTY-001 round 1 (2026-05-25):sourceDetail 常是 raw debug 串(含 = / POST / path),
//   塞進 user-facing summary 會讓 readability 崩。判定為 debug-ish → 不 inline,移到 title;
//   保留 cleanly localized 的 detail(沒有 = 沒有 / 沒有 \ ,且在 DETAIL_KNOWN 內或全中文)
const DETAIL_KNOWN_TOP: Record<string, string> = {
  "stop button": "停止按鈕",
  resume: "繼續執行",
  "iter_stop_at_limit": "已達 iter 上限",
};
function isDebugDetail(s: string): boolean {
  return /[=/\\]|POST|GET|PUT|DELETE/.test(s);
}
function topAuditSourceLabel(e: AuditEntry): { text: string; rawTitle?: string } {
  const known = TOP_AUDIT_SOURCE[e.source];
  const rawDetail = e.sourceDetail;
  const cleanDetail = rawDetail
    ? (DETAIL_KNOWN_TOP[rawDetail] ?? (isDebugDetail(rawDetail) ? null : rawDetail))
    : null;
  if (known) {
    return {
      text: cleanDetail ? `${known}(${cleanDetail})` : known,
      rawTitle: rawDetail && cleanDetail !== rawDetail ? `${e.source} · ${rawDetail}` : undefined,
    };
  }
  // 未知 source:visible 用通用詞「系統」,完整 raw 移到 title 供 dev hover
  const raw = rawDetail ? `${e.source} · ${rawDetail}` : e.source;
  return { text: "系統", rawTitle: raw };
}

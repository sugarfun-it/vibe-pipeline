import { useEffect, useId, useState } from "react";
import * as api from "../../api/projects";
import type { AuditEntry } from "../../api/projects";
import { ArrowRightIcon, ChevronIcon } from "../../ui/icons";
import "./auditTimeline.css";

// Pipeline 狀態變動歷史 timeline。
// 顯示 .vibe-pipeline/.runtime/audit.jsonl 內最近 N 筆 state_change entry,
// 解「pipeline.state 變 X 但不知道誰標的」debug 痛點。
//
// 預設收合(避免大 drawer 一開就被歷史塞滿),user 自己展開看。
export function AuditTimeline({
  projectHash,
  pipelineId,
  defaultOpen = false,
  limit = 50,
}: {
  projectHash: string;
  pipelineId: string;
  defaultOpen?: boolean;
  limit?: number;
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .getPipelineAudit(projectHash, pipelineId, limit)
      .then((arr) => {
        if (cancelled) return;
        setEntries(arr);
        setError(null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectHash, pipelineId, limit]);

  return (
    <div className="tdrw-section">
      <button
        type="button"
        className="audit-toggle tdrw-section-label"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span
          className="audit-chev"
          aria-hidden
          style={{
            display: "inline-flex",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 120ms ease",
          }}
        >
          <ChevronIcon />
        </span>
        狀態變動歷史
      </button>
      {open && (
        <div className="tdrw-section-body" id={panelId} role="region" aria-label="狀態變動歷史">
          {error && <div className="tdrw-empty">讀取失敗:{error}</div>}
          {!error && entries === null && <div className="tdrw-empty">載入中…</div>}
          {!error && entries && entries.length === 0 && (
            <div className="tdrw-empty">尚無紀錄</div>
          )}
          {!error && entries && entries.length > 0 && (
            <>
              <div className="audit-sort-hint" aria-live="polite">最新在上</div>
              <div className="audit-list">
                {entries.map((e, i) => (
                  <AuditRow key={`${e.ts}-${i}`} entry={e} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 把後端 source 機器代號翻成中文,user 不需要懂 runner-self-detected / api-handler-explicit;
// 找不到對應就 fallback 原值(保開發者可讀性)
const SOURCE_LABEL: Record<string, string> = {
  "user-action": "使用者操作",
  "api-handler-explicit": "API 明確指定",
  "runner-self-detected": "Runner 自動偵測",
  "orchestrator.spawnDirect": "Orchestrator 啟動",
  "ticketWatcher-detected": "Ticket Watcher 偵測",
};

function AuditRow({ entry }: { entry: AuditEntry }) {
  const srcLabel = SOURCE_LABEL[entry.source] ?? entry.source;
  return (
    <div className="audit-row">
      <span className="audit-ts mono">{fmtTime(entry.ts)}</span>
      <span className="audit-states">
        <span className="audit-from mono">{entry.from}</span>
        <span className="audit-arrow" aria-hidden>
          <ArrowRightIcon />
        </span>
        <span className="audit-to mono">{entry.to}</span>
      </span>
      <span className="audit-source-line">
        <span className="audit-source" title={entry.source}>{srcLabel}</span>
        {entry.sourceDetail && (
          <span className="audit-detail mono"> · {entry.sourceDetail}</span>
        )}
      </span>
    </div>
  );
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

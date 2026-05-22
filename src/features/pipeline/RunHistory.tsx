import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api/projects";
import type { RunSummary, RunDetail } from "../../api/projects";
import { fmtDuration } from "../../data/pipelines";

// stdout raw 預設只顯前 N 行,避免 10-50KB JSONL 整段渲染拖慢 drawer 滾動。
// user 點「展開全部」才完整顯示。
const STDOUT_PREVIEW_LINES = 80;

export function RunHistory({
  projectHash,
  pipelineId,
}: {
  projectHash: string;
  pipelineId: string;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 切 pipeline 立即清舊 state — 否則「上次 error」會卡在 UI、上次 runs 殘留到新 fetch 完才換
    setRuns(null);
    setError(null);
    let cancelled = false;
    api
      .listPipelineRuns(projectHash, pipelineId)
      .then((arr) => {
        if (cancelled) return;
        setRuns(arr);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectHash, pipelineId]);

  // pipeline 級總計:整條 pipeline 跑下來累積 cost / 時間 / 次數
  const summary = useMemo(() => {
    if (!runs || runs.length === 0) return null;
    let totalCost = 0;
    let totalDuration = 0;
    let costCount = 0;
    let durCount = 0;
    for (const r of runs) {
      if (r.costUsd != null) {
        totalCost += r.costUsd;
        costCount++;
      }
      if (r.durationMs != null) {
        totalDuration += r.durationMs;
        durCount++;
      }
    }
    return {
      count: runs.length,
      totalCost: costCount > 0 ? totalCost : null,
      totalDuration: durCount > 0 ? totalDuration : null,
    };
  }, [runs]);

  if (error) {
    return <div className="tdrw-empty">讀取執行紀錄失敗: {error}</div>;
  }
  if (runs === null) {
    return <div className="tdrw-empty">載入中…</div>;
  }
  if (runs.length === 0) {
    return <div className="tdrw-empty">尚未執行過</div>;
  }

  return (
    <div className="tdrw-runs">
      {summary && (
        <div className="tdrw-runs-summary">
          <span className="tdrw-run-meta-item">
            <span className="tdrw-run-meta-label">執行次數</span>
            <strong>{summary.count}</strong>
          </span>
          <span className="tdrw-run-meta-item">
            <span className="tdrw-run-meta-label">總時間</span>
            <strong>
              {summary.totalDuration != null ? fmtDuration(summary.totalDuration) : "—"}
            </strong>
          </span>
          <span className="tdrw-run-meta-item">
            <span className="tdrw-run-meta-label">總成本</span>
            <strong>
              {summary.totalCost != null ? `$${summary.totalCost.toFixed(2)}` : "—"}
            </strong>
          </span>
        </div>
      )}
      {runs.map((r) => (
        <RunCard
          // key 含 projectHash/pipelineId — 切 pipeline 時 RunCard 重 mount,內部 open/detail cache 不會被同 filename 的其他 pipeline run 錯誤複用
          key={`${projectHash}/${pipelineId}/${r.filename}`}
          run={r}
          projectHash={projectHash}
          pipelineId={pipelineId}
        />
      ))}
    </div>
  );
}

// 每張 RunCard 自管 open / detail / loading state。多張可同時展開,user 想 compare 兩輪(e.g.「第 3 輪 fail 第 4 輪 pass 差在哪」)直接開兩張看;
// detail close 後仍留在 state,re-open 不重 fetch。
function RunCard({
  run,
  projectHash,
  pipelineId,
}: {
  run: RunSummary;
  projectHash: string;
  pipelineId: string;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // unmount 後遲到的 detail 回應不可 setState(切 pipeline / drawer close 時 RunCard 會 unmount,但 fetch 仍在飛)
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const handleToggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !detailLoading) {
      setDetailLoading(true);
      api
        .getPipelineRun(projectHash, pipelineId, run.filename)
        .then((d) => { if (mountedRef.current) setDetail(d); })
        .catch(() => {
          // detail 載入失敗就停在 null;close+open 再試
        })
        .finally(() => { if (mountedRef.current) setDetailLoading(false); });
    }
  };

  const ok = run.exitCode === 0;
  const cost = run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : "—";
  const dur = run.durationMs != null ? fmtDuration(run.durationMs) : "—";
  const turns = run.numTurns != null ? `${run.numTurns} turns` : "—";
  const tokens = run.tokens
    ? `in ${fmtNum(run.tokens.input)} · out ${fmtNum(run.tokens.output)} · cache ${fmtNum(
        run.tokens.cacheRead
      )}${
        run.tokens.reasoning != null && run.tokens.reasoning > 0
          ? ` · reason ${fmtNum(run.tokens.reasoning)}`
          : ""
      }`
    : "—";
  // codex 沒成本 / 回合 / Tokens 資料(全 null 或語意空),隱藏這三欄避免「—」滿版
  const isCodex = run.provider === "codex";
  const ticketDiff = computeTicketDiff(run.ticketsBefore, run.ticketsAfter);
  return (
    <div className="tdrw-run-card">
      <button type="button"
        className="tdrw-run-head"
        onClick={handleToggle}
        aria-expanded={open}
        title={open ? "收合" : "展開"}
      >
        <span className="tdrw-run-head-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <div className="tdrw-run-head-title">
          <span className="mono">{fmtTime(run.startedAt)}</span>
          <span className={"tdrw-run-status " + (ok ? "is-ok" : "is-fail")}>
            exit {run.exitCode ?? "?"}
          </span>
          <span className="tdrw-run-status" title="provider · model">
            {run.provider || run.model
              ? `${run.provider ?? "—"} · ${run.model ?? "—"}`
              : "—"}
          </span>
          {run.result && (
            <span className="tdrw-run-result" title={run.result}>
              {run.result}
            </span>
          )}
        </div>
        <span />
      </button>
      <div className="tdrw-run-meta">
        <span className="tdrw-run-meta-item">
          <span className="tdrw-run-meta-label">時間</span>
          <strong>{dur}</strong>
        </span>
        {!isCodex && (
          <>
            <span className="tdrw-run-meta-item">
              <span className="tdrw-run-meta-label">成本</span>
              <strong>{cost}</strong>
            </span>
            <span className="tdrw-run-meta-item">
              <span className="tdrw-run-meta-label">回合</span>
              <strong>{turns}</strong>
            </span>
            <span className="tdrw-run-meta-item">
              <span className="tdrw-run-meta-label">Tokens</span>
              <strong>{tokens}</strong>
            </span>
          </>
        )}
        {run.failureReason && (
          <span className="tdrw-run-meta-item" title={run.failureReason}>
            <span className="tdrw-run-meta-label">失敗原因</span>
            <strong>{run.failureReason}</strong>
          </span>
        )}
        {ticketDiff.length > 0 && (
          <span className="tdrw-run-meta-item">
            <span className="tdrw-run-meta-label">Ticket 進度</span>
            <strong>
              {ticketDiff.map((d, i) => (
                <span key={d.id}>
                  {i > 0 ? " / " : ""}
                  {d.id}: {d.from}→{d.to}
                </span>
              ))}
            </strong>
          </span>
        )}
      </div>

      {open && (
        <div className="tdrw-run-detail">
          {detailLoading && <div className="tdrw-empty">載入中…</div>}
          {detail && !detailLoading && (
            <>
              {detail.result && (
                <>
                  <div className="tdrw-run-detail-label">result</div>
                  <div className="tdrw-text">{detail.result}</div>
                </>
              )}
              {detail.sessionId && (
                <>
                  <div className="tdrw-run-detail-label">session id</div>
                  <pre className="tdrw-run-pre">{detail.sessionId}</pre>
                </>
              )}
              <div className="tdrw-run-detail-label">stdout (raw)</div>
              <StdoutBlock text={detail.stdout || ""} />
              {detail.stderr && (
                <>
                  <div className="tdrw-run-detail-label">stderr</div>
                  <pre className="tdrw-run-pre">{detail.stderr}</pre>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 長 stdout 預設只顯前 N 行 + 行數 hint;點按鈕展開 / 收合。
// 不嘗試 parse JSONL — stdout 結構不穩(claude / codex / mixed plain text),先解「太長卡頓」問題。
function StdoutBlock({ text }: { text: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const overLimit = lines.length > STDOUT_PREVIEW_LINES;
  const showFull = expanded || !overLimit;
  const previewText = showFull
    ? text
    : lines.slice(0, STDOUT_PREVIEW_LINES).join("\n");
  return (
    <>
      <pre className="tdrw-run-pre">{previewText || "(empty)"}</pre>
      {overLimit && (
        <button
          type="button"
          className="btn tdrw-run-pre-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? `收合(全 ${lines.length} 行)`
            : `展開全部(+${lines.length - STDOUT_PREVIEW_LINES} 行 / 全 ${lines.length} 行)`}
        </button>
      )}
    </>
  );
}

// 比對 spawn 前 / exit 後 ticket 狀態,只列有差的;沒 snapshot 回空陣列
function computeTicketDiff(
  before: RunSummary["ticketsBefore"],
  after: RunSummary["ticketsAfter"],
): Array<{ id: string; from: string; to: string }> {
  if (!before || !after) return [];
  const beforeMap = new Map(before.map((t) => [t.id, t.status]));
  const out: Array<{ id: string; from: string; to: string }> = [];
  for (const t of after) {
    const from = beforeMap.get(t.id) ?? "(新)";
    if (from !== t.status) out.push({ id: t.id, from, to: t.status });
  }
  return out;
}

function fmtNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

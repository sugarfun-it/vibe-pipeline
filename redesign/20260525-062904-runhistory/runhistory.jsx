// RunHistory SSOT — DOM/className verbatim from
// src/features/pipeline/RunHistory.tsx. Type annotations stripped (JSX),
// API calls replaced with stub fixtures, driven by the demo control panel.
// Source of truth for any classname / text string lives here AND in the
// inline <script> block of "Prototype - RunHistory.html" — kept in sync.

const { useEffect, useId, useMemo, useState } = React;

// ─── icons (from src/ui/icons.tsx) ──────────────────────────────
function ChevronIcon(p) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ─── constants (from RunHistory.tsx) ────────────────────────────
const STDOUT_PREVIEW_LINES = 80;

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const STATE_LABELS = {
  ready: "可合併",
  running: "執行中",
  paused: "已暫停",
  done: "完成",
  merged: "已合併",
  failed: "失敗",
  merge_failed: "合併失敗",
};
const TICKET_STATUS_LABELS = {
  draft: "草稿",
  done: "完成",
  split: "已拆分",
  pending: "待處理",
};

// ─── helpers (from RunHistory.tsx) ──────────────────────────────
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function fmtNum(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
function fmtTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function formatFailureReason(raw) {
  const trimmed = raw.trim();
  let display = trimmed;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const message =
        (typeof parsed.message === "string" && parsed.message) ||
        (typeof parsed.error === "string" && parsed.error) ||
        (typeof parsed.error?.message === "string" && parsed.error.message) ||
        (typeof parsed.code === "string" && parsed.code) ||
        (typeof parsed.api_error_status === "number" && `API ${parsed.api_error_status}`) ||
        (typeof parsed.subtype === "string" && parsed.subtype) ||
        "";
      if (message) display = message;
    } catch {}
  }
  return display.length > 120 ? `${display.slice(0, 120)}…` : display;
}
function localizeResult(raw) {
  let s = raw;
  s = s.replace(/全\s*PASS/gi, "全數通過");
  s = s.replace(/(\d+)\s*commit(?![=:\-])/gi, "$1 個 commit");
  s = s.replace(/可\s*merge/gi, "可合併");
  s = s.replace(/,(?=\S)/g, ", ");
  s = s.replace(/state=([a-z_]+)/gi, (_, k) => {
    const lc = k.toLowerCase();
    return STATE_LABELS[lc] != null ? `狀態:${STATE_LABELS[lc]}` : `state=${k}`;
  });
  s = s.replace(/pipeline\.狀態/g, "pipeline 狀態");
  s = s.replace(/(可合併)\s*[,，、]\s*可合併/g, "$1");
  s = s.replace(/, (?=[一-鿿])/g, ",");
  s = s.replace(/, (?=[一-鿿])/g, ",");
  s = s.replace(/([一-鿿])(\d|[A-Za-z])/g, "$1 $2");
  s = s.replace(/(\d|[A-Za-z])([一-鿿])/g, "$1 $2");
  s = s.replace(/([a-z_]+)\s*(?:→|->)\s*([a-z_]+)/gi, (m, fromK, toK) => {
    const f = fromK.toLowerCase();
    const t = toK.toLowerCase();
    const from = TICKET_STATUS_LABELS[f];
    const to = TICKET_STATUS_LABELS[t];
    return from != null && to != null ? `${from}→${to}` : m;
  });
  return s;
}
function renderResult(raw) {
  let s = raw;
  s = s.replace(/全\s*PASS/gi, "全數通過");
  s = s.replace(/(\d+)\s*commit(?![=:\-])/gi, "$1 個 commit");
  s = s.replace(/可\s*merge/gi, "可合併");
  s = s.replace(/pipeline\.狀態/g, "pipeline 狀態");
  s = s.replace(/,(?=\S)/g, ", ");
  s = localizeResult(s);
  const parts = [];
  const re = /([a-z_][a-z0-9_.]*=[a-z0-9_\-]+)/gi;
  let lastIndex = 0;
  let m;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > lastIndex) parts.push(s.slice(lastIndex, m.index));
    parts.push(<code key={`c${key++}`}>{m[0]}</code>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < s.length) parts.push(s.slice(lastIndex));
  return <>{parts.length > 0 ? parts : s}</>;
}
function computeTicketDiff(before, after) {
  if (!before || !after) return [];
  const beforeMap = new Map(before.map((t) => [t.id, t.status]));
  const out = [];
  for (const t of after) {
    const from = beforeMap.get(t.id) ?? "(新)";
    if (from !== t.status) out.push({ id: t.id, from, to: t.status });
  }
  return out;
}

// minimal copy-feedback hook (mirrors src/hooks/useCopiedFeedback)
function useCopiedFeedback() {
  const [copied, setCopied] = useState(false);
  const flash = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return { copied, flash };
}

// ─── RunHistory ────────────────────────────────────────────────
export function RunHistory({
  projectHash,
  pipelineId,
  onCloseDrawer,
  fetchRuns,          // prop injection (replaces api.listPipelineRuns)
  fetchDetail,        // prop injection (replaces api.getPipelineRun)
  initialRuns,        // sync override: null=loading, []=empty
}) {
  const [runs, setRuns] = useState(initialRuns !== undefined ? initialRuns : null);

  useEffect(() => {
    if (initialRuns !== undefined) {
      setRuns(initialRuns);
      return;
    }
    setRuns(null);
    let cancelled = false;
    Promise.resolve(fetchRuns ? fetchRuns(projectHash, pipelineId) : []).then((arr) => {
      if (cancelled) return;
      setRuns(arr);
    });
    return () => { cancelled = true; };
  }, [projectHash, pipelineId, initialRuns, fetchRuns]);

  const summary = useMemo(() => {
    if (!runs || runs.length === 0) return null;
    let totalCost = 0;
    let totalDuration = 0;
    let costCount = 0;
    let durCount = 0;
    let missingCost = 0;
    for (const r of runs) {
      if (r.costUsd != null) { totalCost += r.costUsd; costCount++; } else { missingCost++; }
      if (r.durationMs != null) { totalDuration += r.durationMs; durCount++; }
    }
    return {
      count: runs.length,
      totalCost: costCount > 0 ? totalCost : null,
      totalDuration: durCount > 0 ? totalDuration : null,
      costPartial: costCount > 0 && missingCost > 0,
    };
  }, [runs]);

  if (runs === null) {
    return (
      <div className="tdrw-empty" role="status" aria-live="polite">
        載入執行紀錄中…
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <div className="rh-empty-state">
        <div className="rh-empty-title">這個 pipeline 還沒被執行過</div>
        <div className="rh-empty-hint">
          這裡會列出每次執行後 runner 留下的紀錄,包含耗時、成本與結果。目前還沒有任何一筆。
        </div>
        {onCloseDrawer && (
          <div className="rh-empty-actions">
            <button type="button" className="btn rh-empty-cta" onClick={onCloseDrawer}>
              關閉執行紀錄
            </button>
          </div>
        )}
      </div>
    );
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
          <span
            className="tdrw-run-meta-item"
            title={summary.costPartial ? "部分執行(如 codex)未回報成本,僅累計有資料的執行" : undefined}
          >
            <span className="tdrw-run-meta-label">總成本</span>
            <strong>
              {summary.totalCost != null ? `$${summary.totalCost.toFixed(2)}` : "—"}
            </strong>
            {summary.costPartial && (
              <span className="tdrw-run-meta-partial">(部分)</span>
            )}
          </span>
        </div>
      )}
      {runs.map((r) => (
        <RunCard
          key={`${projectHash}/${pipelineId}/${r.filename}`}
          run={r}
          projectHash={projectHash}
          pipelineId={pipelineId}
          fetchDetail={fetchDetail}
        />
      ))}
    </div>
  );
}

function RunCard({ run, projectHash, pipelineId, fetchDetail }) {
  const [open, setOpen] = useState(!!run._initialOpen);
  const [detail, setDetail] = useState(run._initialDetail ?? null);
  const [detailLoading, setDetailLoading] = useState(!!run._initialDetailLoading);
  const [detailFailed, setDetailFailed] = useState(!!run._initialDetailFailed);
  const headId = useId();
  const detailId = useId();

  const loadDetail = async () => {
    setDetailFailed(false);
    setDetailLoading(true);
    try {
      const d = await (fetchDetail
        ? fetchDetail(projectHash, pipelineId, run.filename)
        : Promise.resolve(null));
      setDetail(d);
    } catch (e) {
      setDetailFailed(true);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !detailLoading) {
      loadDetail();
    }
  };

  const ok = run.exitCode === 0;
  const exitText = run.exitCode != null ? `退出碼 ${run.exitCode}` : "退出碼 ?";
  const outcomeLabel = ok ? "成功" : "失敗";
  const chipText = ok ? outcomeLabel : `${outcomeLabel} · ${exitText}`;
  const cost = run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : "—";
  const dur = run.durationMs != null ? fmtDuration(run.durationMs) : "—";
  const turns = run.numTurns != null ? `${run.numTurns}` : "—";
  const tokens = run.tokens
    ? `輸入 ${fmtNum(run.tokens.input)} · 輸出 ${fmtNum(run.tokens.output)} · 快取 ${fmtNum(run.tokens.cacheRead)}${
        run.tokens.reasoning != null && run.tokens.reasoning > 0
          ? ` · 推理 ${fmtNum(run.tokens.reasoning)}`
          : ""
      }`
    : "—";
  const isCodex = run.provider === "codex";
  const ticketDiff = computeTicketDiff(run.ticketsBefore, run.ticketsAfter);
  const fullProvider = run.provider || run.model
    ? `${run.provider ?? "—"} · ${run.model ?? "—"}`
    : "—";
  const toggleAria = `${open ? "收合" : "展開"} ${fmtTime(run.startedAt)} 的執行明細(${outcomeLabel}・${exitText})`;
  const toggleHint = open ? "收合輸出" : "查看輸出";

  return (
    <div className={"tdrw-run-card" + (ok ? "" : " is-fail")}>
      <button
        type="button"
        id={headId}
        className="tdrw-run-head"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={toggleAria}
        title={open ? "收合此執行紀錄" : "展開此執行紀錄"}
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          alignItems: "center",
          columnGap: "8px",
          width: "100%",
        }}
      >
        <span style={visuallyHidden}>{open ? "收合" : "展開"}</span>
        <span
          className="tdrw-run-head-chev"
          aria-hidden="true"
          style={{
            display: "inline-flex",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 120ms ease",
          }}
        >
          <ChevronIcon />
        </span>
        <div className="tdrw-run-head-title">
          <span className="mono">{fmtTime(run.startedAt)}</span>
          <span
            className={"tdrw-run-status " + (ok ? "is-ok" : "is-fail")}
            data-state={ok ? "success" : "failed"}
            title={`${outcomeLabel} · ${exitText}`}
          >
            {chipText}
          </span>
          {run.result && (
            <span
              className="tdrw-run-result"
              title={run.result}
              style={{
                whiteSpace: "normal",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {localizeResult(run.result)}
            </span>
          )}
        </div>
        <span
          aria-hidden="true"
          className="tdrw-run-head-hint"
          style={{
            fontSize: 11,
            color: "var(--fg-faint)",
            whiteSpace: "nowrap",
          }}
        >
          {toggleHint}
        </span>
      </button>
      <div className="tdrw-run-meta">
        <span className="tdrw-run-meta-item">
          <span className="tdrw-run-meta-label">耗時</span>
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
              <span className="tdrw-run-meta-label">權杖數</span>
              <strong>{tokens}</strong>
            </span>
          </>
        )}
        {(run.provider || run.model) && (
          <span className="tdrw-run-meta-provider">
            <span className="tdrw-run-meta-label">執行器</span>
            <span className="tdrw-run-meta-provider-value">{fullProvider}</span>
          </span>
        )}
        {run.failureReason && (
          <span
            className="tdrw-run-meta-item tdrw-run-meta-fail"
            title={run.failureReason}
          >
            <span className="tdrw-run-meta-label">失敗原因</span>
            <strong>{formatFailureReason(run.failureReason)}</strong>
          </span>
        )}
        {ticketDiff.length > 0 && (
          <span className="tdrw-run-meta-item tdrw-run-meta-ticket-diff">
            <span className="tdrw-run-meta-label">Ticket 進度</span>
            <span className="tdrw-run-meta-ticket-diff-list">
              {ticketDiff.map((d) => (
                <span key={d.id} className="tdrw-run-meta-ticket-diff-item">
                  {d.id}: {TICKET_STATUS_LABELS[d.from] ?? d.from}→{TICKET_STATUS_LABELS[d.to] ?? d.to}
                </span>
              ))}
            </span>
          </span>
        )}
      </div>

      {open && (
        <div id={detailId} role="region" aria-labelledby={headId} className="tdrw-run-detail">
          {detailLoading && <div className="tdrw-empty">載入執行明細中…</div>}
          {detailFailed && !detailLoading && !detail && (
            <div className="tdrw-empty tdrw-run-detail-error">
              <button type="button" className="btn tdrw-run-pre-toggle" onClick={() => loadDetail()}>
                重試
              </button>
            </div>
          )}
          {detail && !detailLoading && (
            <>
              {detail.result && (
                <section className="tdrw-run-detail-section tdrw-run-detail-result">
                  <h4 className="tdrw-run-detail-label">結果</h4>
                  <div className="tdrw-text">{renderResult(detail.result)}</div>
                </section>
              )}
              {detail.sessionId && (
                <section className="tdrw-run-detail-section">
                  <h4 className="tdrw-run-detail-label">工作階段 ID</h4>
                  <CopyableBlock
                    text={detail.sessionId}
                    oneLine
                    readonlyStyle
                    copyAriaLabel="複製工作階段 ID"
                  />
                </section>
              )}
              <section className="tdrw-run-detail-section">
                <h4 className="tdrw-run-detail-label">
                  原始輸出{" "}
                  <span className="tdrw-run-detail-tag">stdout</span>
                </h4>
                <StdoutBlock text={detail.stdout || ""} />
              </section>
              {detail.stderr && (
                <section className="tdrw-run-detail-section">
                  <h4 className="tdrw-run-detail-label">
                    錯誤輸出{" "}
                    <span className="tdrw-run-detail-tag">stderr</span>
                  </h4>
                  <CopyableBlock text={detail.stderr} copyAriaLabel="複製錯誤輸出" />
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StdoutBlock({ text }) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const charCount = text.length;
  const isEmpty = charCount === 0;
  const overLimit = lines.length > STDOUT_PREVIEW_LINES;
  const showFull = expanded || !overLimit;
  const previewText = showFull
    ? text
    : lines.slice(0, STDOUT_PREVIEW_LINES).join("\n");
  return (
    <>
      <pre className="tdrw-run-pre" aria-label="原始輸出 stdout">
        {isEmpty ? "(空)" : previewText}
      </pre>
      {overLimit && (
        <div className="tdrw-run-pre-tools">
          <button
            type="button"
            className="btn tdrw-run-pre-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded
              ? `收合(全 ${lines.length} 行)`
              : `展開全部(+${lines.length - STDOUT_PREVIEW_LINES} 行 / 全 ${lines.length} 行)`}
          </button>
        </div>
      )}
    </>
  );
}

function CopyableBlock({ text, oneLine, readonlyStyle, copyAriaLabel }) {
  const { copied, flash: flashCopied } = useCopiedFeedback();
  const handleCopy = () => {
    if (!text) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => flashCopied(), () => {});
    } else {
      flashCopied();
    }
  };
  const preClass = readonlyStyle
    ? "tdrw-run-session-id"
    : "tdrw-run-pre" + (oneLine ? " is-oneline" : "");
  return (
    <>
      <pre className={preClass}>{text || "(空)"}</pre>
      <div className="tdrw-run-pre-tools">
        <button
          type="button"
          className="btn tdrw-run-pre-toggle"
          onClick={handleCopy}
          disabled={!text}
          aria-label={copyAriaLabel || "複製"}
          title={copyAriaLabel || "複製到剪貼簿"}
        >
          {copied ? "已複製" : "複製"}
        </button>
        <span style={visuallyHidden} aria-live="polite">{copied ? "已複製" : ""}</span>
      </div>
    </>
  );
}

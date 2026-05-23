import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import * as api from "../../api/projects";
import type { RunSummary, RunDetail } from "../../api/projects";
import { fmtDuration } from "../../data/pipelines";
import { ChevronIcon } from "../../ui/icons";
import { useToast } from "../../ui/Toast";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useCopiedFeedback } from "../../hooks/useCopiedFeedback";

// stdout raw 預設只顯前 N 行,避免 10-50KB JSONL 整段渲染拖慢 drawer 滾動。
// user 點「展開全部」才完整顯示。
const STDOUT_PREVIEW_LINES = 80;

// 視覺隱藏但保留 SR 可讀(等同標準 sr-only utility)— RunHistory 沒掛 src/styles 全域 class,
// 用 inline style 在元件內 self-contained,避免依賴 phase4 才會加上的 .sr-only。
const visuallyHidden: CSSProperties = {
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

// RH-011:stdout / stderr 在 h4 旁的 mono badge — implementation 來源字串退一格,user 視覺主體留中文
const detailTagStyle: CSSProperties = {
  display: "inline-block",
  marginLeft: 6,
  padding: "1px 5px",
  borderRadius: 3,
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 500,
  color: "var(--fg-faint)",
  background: "var(--panel-2)",
  border: "1px solid var(--line)",
  textTransform: "lowercase",
  letterSpacing: "0.04em",
};

export function RunHistory({
  projectHash,
  pipelineId,
}: {
  projectHash: string;
  pipelineId: string;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // 切 pipeline 立即清舊 runs — 上次資料殘留到新 fetch 完才換會誤導
    setRuns(null);
    let cancelled = false;
    api
      .listPipelineRuns(projectHash, pipelineId)
      .then((arr) => {
        if (cancelled) return;
        setRuns(arr);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        toast(`讀取執行紀錄失敗:${e.message}`, { variant: "danger" });
        setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectHash, pipelineId, toast]);

  // pipeline 級總計:整條 pipeline 跑下來累積 cost / 時間 / 次數。
  // costPartial:有 run 缺 cost(codex 等)時標記,避免顯示誤導性「總成本」
  const summary = useMemo(() => {
    if (!runs || runs.length === 0) return null;
    let totalCost = 0;
    let totalDuration = 0;
    let costCount = 0;
    let durCount = 0;
    let missingCost = 0;
    for (const r of runs) {
      if (r.costUsd != null) {
        totalCost += r.costUsd;
        costCount++;
      } else {
        missingCost++;
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
      costPartial: costCount > 0 && missingCost > 0,
    };
  }, [runs]);

  if (runs === null) {
    return <div className="tdrw-empty">載入執行紀錄中…</div>;
  }
  if (runs.length === 0) {
    return <div className="tdrw-empty">尚無執行紀錄</div>;
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
            title={
              summary.costPartial
                ? "部分執行(如 codex)未回報成本,僅累計有資料的執行"
                : undefined
            }
          >
            <span className="tdrw-run-meta-label">
              總成本{summary.costPartial ? "(部分)" : ""}
            </span>
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
  const [detailFailed, setDetailFailed] = useState(false);
  const { toast } = useToast();
  // a11y: head button 跟 detail region 用 useId 對接;screen reader 知道哪段 detail 屬於哪張卡
  const headId = useId();
  const detailId = useId();
  // useAsyncAction 已含 mounted guard,卸載後晚到回應不再 setState
  const [loadDetail, { pending: detailLoading }] = useAsyncAction(async () => {
    setDetailFailed(false);
    try {
      const d = await api.getPipelineRun(projectHash, pipelineId, run.filename);
      setDetail(d);
    } catch (e) {
      setDetailFailed(true);
      const msg = e instanceof Error ? e.message : "未知錯誤";
      toast(`讀取執行明細失敗:${msg}`, { variant: "danger" });
      throw e;
    }
  });

  const handleToggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !detailLoading) {
      loadDetail();
    }
  };

  const ok = run.exitCode === 0;
  // RH-005 / RH-016:exit X → 退出碼 X(原本 chip 同時混 zh / en「成功 · EXIT 0」現在改「成功 · 退出碼 0」)
  const exitText = run.exitCode != null ? `退出碼 ${run.exitCode}` : "退出碼 ?";
  const outcomeLabel = ok ? "成功" : "失敗";
  const cost = run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : "—";
  const dur = run.durationMs != null ? fmtDuration(run.durationMs) : "—";
  const turns = run.numTurns != null ? `${run.numTurns}` : "—";
  const tokens = run.tokens
    ? `輸入 ${fmtNum(run.tokens.input)} · 輸出 ${fmtNum(run.tokens.output)} · 快取 ${fmtNum(
        run.tokens.cacheRead
      )}${
        run.tokens.reasoning != null && run.tokens.reasoning > 0
          ? ` · 推理 ${fmtNum(run.tokens.reasoning)}`
          : ""
      }`
    : "—";
  // codex 沒成本 / 回合 / Tokens 資料(全 null 或語意空),隱藏這三欄避免「—」滿版
  const isCodex = run.provider === "codex";
  const ticketDiff = computeTicketDiff(run.ticketsBefore, run.ticketsAfter);
  const fullProvider = run.provider || run.model
    ? `${run.provider ?? "—"} · ${run.model ?? "—"}`
    : "—";
  // RH-006:provider chip 全文不能只塞 title(touch 看不到、SR 不可靠)— 同字串塞進可見內容的 aria-label,
  //         然後在 chip 外另放 sr-only 隱藏 span 給 SR 唸完整(visible chip 仍 ellipsis 防爆版)
  const toggleAria = `${open ? "收合" : "展開"} ${fmtTime(run.startedAt)} 的執行明細(${outcomeLabel})`;
  return (
    <div className={"tdrw-run-card" + (ok ? "" : " is-fail")}>
      <button type="button"
        id={headId}
        className="tdrw-run-head"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={toggleAria}
        title={open ? "收合此執行紀錄" : "展開此執行紀錄"}
      >
        {/* hist-010:chevron 仍 aria-hidden,但配 sr-only 文字補強「收合 / 展開」狀態給 SR */}
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
          {/* hist-003:header 只留時間 + 狀態 chip(成功 / 失敗 · 退出碼 N) + result 摘要;
              provider/model + ticket count 推到下面 meta row,不再擠在同一行 */}
          <span
            className={"tdrw-run-status " + (ok ? "is-ok" : "is-fail")}
            data-state={ok ? "success" : "failed"}
            title={`${outcomeLabel} · ${exitText}`}
          >
            {outcomeLabel} · {exitText}
          </span>
          {run.result && (
            // RH-013 / RH-017:visible 段做已知 state token 對應(state=ready / state=running / draft→done 等),
            //                 完整 raw 仍在 title 內保留給 dev / debug 取用,並有 sr-only 全文供 SR
            <span className="tdrw-run-result" title={run.result}>
              {localizeResult(run.result)}
            </span>
          )}
        </div>
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
            {/* RH-005 / RH-016:Tokens → 權杖數,跟其他 zh-TW label 對齊 */}
            <span className="tdrw-run-meta-item">
              <span className="tdrw-run-meta-label">權杖數</span>
              <strong>{tokens}</strong>
            </span>
          </>
        )}
        {/* hist-003 / hist-004:provider/model 移到 meta row 第二行,獨立欄位 + 可換行不再 ellipsis */}
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
          // hist-001:ticket 進度列改 grid:label nowrap 在左,內容換行承接在右,不再讓「度」孤立
          // RH-013 / RH-017:ticket from/to 用已知 enum 對應(draft/done/split/pending);未知值保留原值
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
        <div
          id={detailId}
          role="region"
          aria-labelledby={headId}
          className="tdrw-run-detail"
        >
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
                // hist-013:每個段落 label + 內容包成 section,gap 8px,group margin 跟 detail container gap 一致
                <section className="tdrw-run-detail-section tdrw-run-detail-result">
                  <h4 className="tdrw-run-detail-label">結果</h4>
                  {/* hist-014:result 內 code 值用 mono 包裝,半形逗號 + 全形空格節奏由 formatter 套 */}
                  <div className="tdrw-text">{renderResult(detail.result)}</div>
                </section>
              )}
              {detail.sessionId && (
                // hist-015:session-id 改 read-only code block,short UUID 不附複製按鈕(triple-click 即可選取)
                <section className="tdrw-run-detail-section">
                  <h4 className="tdrw-run-detail-label">工作階段 ID</h4>
                  <pre className="tdrw-run-session-id">{detail.sessionId}</pre>
                </section>
              )}
              {/* hist-005:標題用 zh-TW「原始輸出 · stdout」,實作來源以同列右側 mono badge 形式呈現 */}
              <section className="tdrw-run-detail-section">
                <h4 className="tdrw-run-detail-label">
                  原始輸出{" "}
                  <span className="tdrw-run-detail-tag" style={detailTagStyle}>
                    stdout
                  </span>
                </h4>
                <StdoutBlock text={detail.stdout || ""} />
              </section>
              {detail.stderr && (
                <section className="tdrw-run-detail-section">
                  <h4 className="tdrw-run-detail-label">
                    錯誤輸出{" "}
                    <span className="tdrw-run-detail-tag" style={detailTagStyle}>
                      stderr
                    </span>
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

// stdout 三段式可見性:
//  1. 預設「不顯示主體」— 只露行數 / 字元數 + 「顯示」按鈕(RH-001:stdout 不該宰制 expanded card 視覺)
//  2. 顯示後若 > STDOUT_PREVIEW_LINES 行,只顯前 N 行 + 「展開全部」按鈕
//  3. 完全展開 = 全文
// 不嘗試 parse JSONL — stdout 結構不穩(claude / codex / mixed plain text)
// 額外提供「複製」「換行」工具列,讓 user 拿 stdout 去外部工具看不再要手動全選。
function StdoutBlock({ text }: { text: string }): JSX.Element {
  // stdout 預設直接渲染。lines > STDOUT_PREVIEW_LINES 時截到 preview,提供「展開全部」按鈕。
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

// 用在 sessionId / stderr 等可單獨複製的 pre block。oneLine=true 給 sessionId 之類短字串用,顯示時不撐高
// hist-015:readonlyStyle=true 切換成 read-only code block 樣式(不像 input)
// hist-016:copyAriaLabel 必要傳入,讓 SR / tooltip 知道複製目標是什麼
function CopyableBlock({
  text,
  oneLine,
  readonlyStyle,
  copyAriaLabel,
}: {
  text: string;
  oneLine?: boolean;
  readonlyStyle?: boolean;
  copyAriaLabel?: string;
}): JSX.Element {
  const { copied, flash: flashCopied } = useCopiedFeedback();
  const handleCopy = (): void => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => {
        flashCopied();
      },
      () => {},
    );
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
        {/* RH-010:aria-live 對 SR 報「已複製」狀態 */}
        <span style={visuallyHidden} aria-live="polite">{copied ? "已複製" : ""}</span>
      </div>
    </>
  );
}

// 失敗原因常是整段 JSON(claude CLI / codex / api error response 原樣 dump),直接渲染撐爆 row。
// 是 JSON 就 parse 抽 message/error/code/api_error_status 等可讀欄位;非 JSON 用 raw。最後 truncate 到 120 字。
function formatFailureReason(raw: string): string {
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
    } catch {
      // parse 失敗保留 raw
    }
  }
  return display.length > 120 ? `${display.slice(0, 120)}…` : display;
}

// RH-013 / RH-017:result 字串裡 runner 常 dump 「state=ready」「state=running」「draft→done」之類 raw token,
// 對 user(非 dev)讀起來像漏字。對已知值做 zh-TW 替換,raw 保留在 title 給 dev / debug。
// 邊界:只動已知 enum (ready / running / paused / done / merged / failed / merge_failed),
//      未知 state 保留原樣不亂譯。draft / done / split / pending 等 ticket status 同理。
const STATE_LABELS: Record<string, string> = {
  ready: "可合併",
  running: "執行中",
  paused: "已暫停",
  done: "完成",
  merged: "已合併",
  failed: "失敗",
  merge_failed: "合併失敗",
};
const TICKET_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  done: "完成",
  split: "已拆分",
  pending: "待處理",
};
// hist-014:result 完整版渲染 — 把 `key=value` / `key.field=value` token 用 <code> 包,
// 半形逗號後補空格、半形句點接續用全形句點觀感較統一,但保留 `key=value` 內部不動。
// 「3 個 ticket 全 PASS、3 commit。pipeline.state=ready,可 merge。」
//   → 「3 個 ticket 全數通過,3 個 commit。pipeline.state=ready,可合併。」
function renderResult(raw: string): JSX.Element {
  // domain term(ticket / pipeline / commit / Runner)保留英文,不翻中文。
  // 只翻 PASS→通過、merge→合併 等動作/結果詞。
  let s = raw;
  s = s.replace(/全\s*PASS/gi, "全數通過");
  // 「3 commit」→「3 個 commit」(個量詞)
  s = s.replace(/(\d+)\s*commit(?![=:\-])/gi, "$1 個 commit");
  // 半形逗號接非空白 → 後面補半形空格(東亞排版常見)
  s = s.replace(/,(?=\S)/g, ", ");
  // 同時把舊 state token 透過 localizeResult 翻 zh-TW
  s = localizeResult(s);
  // 把 `key=value` 或 `key.field=value` 包 <code>(保 mono 樣式)
  const parts: Array<string | JSX.Element> = [];
  const re = /([a-z_][a-z0-9_.]*=[a-z0-9_\-]+)/gi;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > lastIndex) parts.push(s.slice(lastIndex, m.index));
    parts.push(<code key={`c${key++}`}>{m[0]}</code>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < s.length) parts.push(s.slice(lastIndex));
  return <>{parts.length > 0 ? parts : s}</>;
}

function localizeResult(raw: string): string {
  let s = raw;
  // state=ready → 狀態:可合併
  s = s.replace(/state=([a-z_]+)/gi, (_, k: string) => {
    const lc = k.toLowerCase();
    return STATE_LABELS[lc] != null ? `狀態:${STATE_LABELS[lc]}` : `state=${k}`;
  });
  // draft→done → 草稿→完成(全形 → 也支援)
  s = s.replace(/([a-z_]+)\s*(?:→|->)\s*([a-z_]+)/gi, (m, fromK: string, toK: string) => {
    const f = fromK.toLowerCase();
    const t = toK.toLowerCase();
    const from = TICKET_STATUS_LABELS[f];
    const to = TICKET_STATUS_LABELS[t];
    return from != null && to != null ? `${from}→${to}` : m;
  });
  return s;
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

// stdout placeholder 顯字元規模,避免 user 不知道 hidden 內容有多大就按 / 不按
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} 字元`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

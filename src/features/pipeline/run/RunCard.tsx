import { useId, useMemo, useState } from "react";
import type { CSSProperties, JSX } from "react";
import * as api from "../../../api";
import type { RunSummary, RunDetail } from "../../../api";
import { fmtDuration } from "../../../lib/pipelines";
import { formatDateTime, formatNum } from "../../../lib/format";
import { ChevronIcon } from "../../../ui/icons";
import { useToast } from "../../../ui/Toast";
import { useAsyncAction } from "../../../hooks/useAsyncAction";
import { useCopiedFeedback } from "../../../hooks/useCopiedFeedback";
import {
  TICKET_STATUS_LABELS,
  formatFailureReason,
  localizeResult,
  renderResult,
} from "../misc/runResultFormat";

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

// 每張 RunCard 自管 open / detail / loading state。多張可同時展開,user 想 compare 兩輪(e.g.「第 3 輪 fail 第 4 輪 pass 差在哪」)直接開兩張看;
// detail close 後仍留在 state,re-open 不重 fetch。
export function RunCard({
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
  // RH-003 (2026-05-24):成功狀態 chip 不再顯「退出碼 0」雜訊 — 每筆都是 0 反而降低掃讀效率;
  //   退出碼仍保留在 title / aria-label 給 dev 取用。失敗時 chip 顯示退出碼(對診斷有意義)。
  const exitText = run.exitCode != null ? `退出碼 ${run.exitCode}` : "退出碼 ?";
  const outcomeLabel = ok ? "成功" : "失敗";
  const chipText = ok ? outcomeLabel : `${outcomeLabel} · ${exitText}`;
  const cost = run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : "—";
  const dur = run.durationMs != null ? fmtDuration(run.durationMs) : "—";
  const turns = run.numTurns != null ? `${run.numTurns}` : "—";
  const tokens = run.tokens
    ? `輸入 ${formatNum(run.tokens.input)} · 輸出 ${formatNum(run.tokens.output)} · 快取 ${formatNum(
        run.tokens.cacheRead
      )}${
        run.tokens.reasoning != null && run.tokens.reasoning > 0
          ? ` · 推理 ${formatNum(run.tokens.reasoning)}`
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
  const toggleAria = `${open ? "收合" : "展開"} ${formatDateTime(run.startedAt)} 的執行明細(${outcomeLabel}・${exitText})`;
  // RH-002 (2026-05-24):chevron 在 mobile 上 affordance 偏弱 — 加個 visible 短 label 提示展開動作,
  //   user 一眼知道整個 head 可點開看詳情(stdout / stderr / session id)
  // HIST-RUN-001 round 1 (2026-05-25):卡片下方 meta(時間/成本/權杖/執行器/Ticket 進度)
  //   已 always-visible,通用「展開」會讓 user 覺得「我已經看到全部了還能展什麼」。
  //   改更具體:展開後實際多 sessionId + 原始輸出(stdout) + stderr,所以 hint = 「查看輸出」/「收合輸出」。
  const toggleHint = open ? "收合輸出" : "查看輸出";
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
        // RH-011 (2026-05-24):mobile 上 chev / title / hint 之前在 .tdrw-run-head 的 grid (auto auto 1fr auto)
        //   下因為加新 hint span 排不進原軌而 wrap 成破碎多行。強制改 3-column grid:
        //     col1=chev 固定寬 / col2=title 1fr 內部自由 wrap / col3=hint 固定寬
        //   inline style 蓋過 ticketDrawer.css 對應 .tdrw-run-head 的 grid 設定(同 selector,
        //   但 inline 比 class 高優先序),保證 mobile 不會把 chev 推到第二行。
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          alignItems: "center",
          columnGap: "8px",
          width: "100%",
        }}
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
          <span className="mono">{formatDateTime(run.startedAt)}</span>
          {/* hist-003:header 只留時間 + 狀態 chip(成功 / 失敗 · 退出碼 N) + result 摘要;
              provider/model + ticket count 推到下面 meta row,不再擠在同一行 */}
          <span
            className={"tdrw-run-status " + (ok ? "is-ok" : "is-fail")}
            data-state={ok ? "success" : "failed"}
            title={`${outcomeLabel} · ${exitText}`}
          >
            {chipText}
          </span>
          {run.result && (
            // RH-013 / RH-017:visible 段做已知 state token 對應(state=ready / state=running / draft→done 等),
            //                 完整 raw 仍在 title 內保留給 dev / debug 取用,並有 sr-only 全文供 SR
            // RH-012 (2026-05-24):mobile 下 result 在窄欄 nowrap+ellipsis 會截在 'rea...' 之類的英 fragment,
            //   破壞 zh 觀感且看不到 state 字眼。改 2-line clamp 讓內容換行兩行,超出再 ellipsis;
            //   full text 仍在 title 給 hover / dev 取用。
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
        {/* RH-002 / RH-011 (2026-05-24) / phase4-2026-05-23-004:visible toggle hint
            在 desktop 顯示(避免 chevron 弱 affordance);mobile 整 head 已經明顯可點,
            chevron 旋轉 + sr-only 「收合/展開」 已足夠,hide visible text 避免雙重疊 affordance。 */}
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
        {/* HIST-RUN-005 round 1 (2026-05-25):同畫面已有「最後變動於」(top summary)、「總時間」(summary),
            這欄是「單次 run 的耗時」,語意要區分清楚不被誤讀為時刻 — 改 label「耗時」。 */}
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
                // hist-015 / HRD-EXP-004 (2026-05-24):read-only code block + 複製按鈕。
                //   session id 是 codex / claude resume 取用的關鍵字串,
                //   triple-click select 在 mobile 不可行,visible copy 按鈕讓兩平台一致。
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
              {/* hist-005:標題用 zh-TW「原始輸出 · stdout」,實作來源以同列右側 mono badge 形式呈現 */}
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

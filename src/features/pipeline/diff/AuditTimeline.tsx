import { useEffect, useId, useState } from "react";
import * as api from "../../../api";
import type { AuditEntry } from "../../../api";
import { ArrowRightIcon, ChevronIcon } from "../../../ui/icons";
import { useToast } from "../../../ui/Toast";
import { formatDateTime } from "../../../lib/format";
import {
  DETAIL_LABEL_ZH,
  localizeAuditDetail,
  localizeAuditState,
  SOURCE_LABEL_ZH,
} from "../../../lib/auditLocalize";
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
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const { toast } = useToast();

  // hist-audit-016 round 4 (2026-05-24):
  //   user 不展開也想知道 audit 有沒有料(empty / non-empty)。原本只在 open 時 fetch,
  //   collapsed 永遠空。改成 mount 時就 fetch 一次當 count preview;展開時靠快取直接顯示。
  //   collapsed fetch 視為輕量 metadata(audit limit=50 entries ~ 5KB),N pipeline open drawer
  //   時最多多打 1 個 GET 不算重。失敗時 fall back 顯示 chevron only(不擋 user 展開)。
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once fetch; `open` intentionally excluded to avoid refetch on expand
  useEffect(() => {
    let cancelled = false;
    api
      .getPipelineAudit(projectHash, pipelineId, limit)
      .then((arr) => {
        if (cancelled) return;
        setEntries(arr);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // open 狀態下 toast user;collapsed 失敗安靜降級為 entries=null(chevron only)
        if (open) toast(`讀取狀態變動歷史失敗:${e.message}`, { variant: "danger" });
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
    // open 不在依賴內 — 只 mount 時 fetch 一次
  }, [projectHash, pipelineId, limit]);

  // hist-empty-016 / HD-013 round 4 (2026-05-24):
  //   collapsed 與 open 都顯示 count badge,user 不展開就能判斷裡面有沒有料。
  //   entries===null → 「···」(載入中);entries===[] → 「0」;否則實際筆數。
  //   配合上面 useEffect 改成 mount 即 fetch 才能在 collapsed 時就有 count。
  const countDisplay =
    entries === null ? "···" : String(entries.length);
  return (
    <div className="tdrw-section">
      <button
        type="button"
        className="audit-toggle tdrw-section-label"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="audit-chev" aria-hidden data-open={open || undefined}>
          <ChevronIcon />
        </span>
        <span className="audit-toggle-label">狀態變動歷史</span>
        <span
          className="audit-count-badge"
          aria-label={
            entries == null
              ? "載入中"
              : `共 ${entries.length} 筆`
          }
          data-empty={entries?.length === 0 || undefined}
        >
          {countDisplay}
        </span>
      </button>
      {open && (
        <div className="tdrw-section-body" id={panelId} role="region" aria-label="狀態變動歷史">
          {/* a11y (audit-long-10 round 3):loading / empty 用 aria-live=polite 宣告;
              長 list 的 individual rows 不放在 aria-live 區內,避免 SR 一次唸完整段(噪音)。
              entries.length>0 時不再 wrap aria-live;改靠 audit-sort-hint 視覺即可。 */}
          {entries === null && (
            <div className="tdrw-empty" role="status" aria-live="polite">
              載入狀態變動歷史中…
            </div>
          )}
          {entries && entries.length === 0 && (
            <div
              className="audit-empty-state"
              role="status"
              aria-live="polite"
            >
              <div className="audit-empty-title">尚無狀態變動</div>
              <div className="audit-empty-hint">
                這個 pipeline 還沒發生過狀態變更(例如:從「規劃中」進入「執行中」、或從「可合併」進入「已合併」)。
              </div>
            </div>
          )}
          {entries && entries.length > 0 && (
            <>
              <div className="audit-sort-hint">
                共 {entries.length} 筆 · 依時間由新到舊
              </div>
              <ol className="audit-list" role="list">
                {entries.map((e, i) => (
                  <AuditRow key={`${e.ts}-${i}`} entry={e} />
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// label maps(state / source / sourceDetail 中譯)搬到 src/lib/auditLocalize.ts 與
// PipelineHistoryDrawer top summary 共用,避免漂移。

// a11y:每 row 給 SR 一句完整描述(時間、from→to、來源)— mono chip 與符號
// 在語意上會被拆散,額外加 aria-label 涵蓋完整轉移。
// audit-long-05a (2026-05-24):state 值用中文映射(visible mono chip 仍保 raw enum 給 dev)。
function AuditRow({ entry }: { entry: AuditEntry }) {
  const srcLabel = SOURCE_LABEL_ZH[entry.source] ?? entry.source;
  const detailLabel = localizeAuditDetail(entry.sourceDetail);
  const ariaLabel = `${formatDateTime(entry.ts)}:由「${localizeAuditState(entry.from)}」變為「${localizeAuditState(entry.to)}」,來源 ${srcLabel}${detailLabel ? `(${detailLabel})` : ""}`;
  return (
    <li className="audit-row" role="listitem" aria-label={ariaLabel}>
      <span className="audit-ts mono" aria-hidden>{formatDateTime(entry.ts)}</span>
      <span className="audit-states" aria-hidden>
        <span className="audit-from mono">{entry.from}</span>
        <span className="audit-arrow" aria-hidden>
          <ArrowRightIcon />
        </span>
        <span className="audit-to mono">{entry.to}</span>
      </span>
      <span className="audit-source-line" aria-hidden>
        <span className="audit-source" title={entry.source}>{srcLabel}</span>
        {detailLabel && (
          // 已知 token 中譯;raw token 保留原樣 + mono 樣式提示為 dev 取用
          <span
            className={DETAIL_LABEL_ZH[entry.sourceDetail ?? ""] ? "audit-detail" : "audit-detail mono"}
            title={entry.sourceDetail !== detailLabel ? entry.sourceDetail : undefined}
          >
            {" · "}
            {detailLabel}
          </span>
        )}
      </span>
    </li>
  );
}


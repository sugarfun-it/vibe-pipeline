import { useEffect, useMemo, useState } from "react";
import * as api from "../../api";
import type { RunSummary } from "../../api";
import { fmtDuration } from "../../lib/pipelines";
import { useToast } from "../../ui/Toast";
import { RunCard } from "./RunCard";

export function RunHistory({
  projectHash,
  pipelineId,
  onCloseDrawer,
}: {
  projectHash: string;
  pipelineId: string;
  // 由 PipelineHistoryDrawer 注入。empty state CTA「關閉並回 pipeline」用,
  // 不傳入時 empty state 不渲染該按鈕(degrade gracefully)。
  onCloseDrawer?: () => void;
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
    return (
      <div className="tdrw-empty" role="status" aria-live="polite">
        載入執行紀錄中…
      </div>
    );
  }
  if (runs.length === 0) {
    // history-empty-001 / 003 / 004 / 006 / 007 / 010 / 012 (2026-05-24)
    // + HD-EMPTY-002 / 003 / 004 round 1 (2026-05-25):
    //   - CTA「關閉並回 pipeline 執行」會被誤讀成「按了會跑 pipeline」,
    //     改成中性、忠實的「關閉執行紀錄」。
    //   - 全形括弧、語句斷句重排,降低 mobile 擁擠感。
    //   - 靜態 empty block 不再 role=status / aria-live(會跟 drawer dialog
    //     + topAudit 重複播報);只在 dialog 內當一般內容。
    return (
      <div className="rh-empty-state">
        <div className="rh-empty-title">這個 pipeline 還沒被執行過</div>
        <div className="rh-empty-hint">
          這裡會列出每次執行後 runner 留下的紀錄,包含耗時、成本與結果。目前還沒有任何一筆。
        </div>
        {onCloseDrawer && (
          <div className="rh-empty-actions">
            <button
              type="button"
              className="btn rh-empty-cta"
              onClick={onCloseDrawer}
            >
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
            title={
              summary.costPartial
                ? "部分執行(如 codex)未回報成本,僅累計有資料的執行"
                : undefined
            }
          >
            <span className="tdrw-run-meta-label">總成本</span>
            <strong>
              {summary.totalCost != null ? `$${summary.totalCost.toFixed(2)}` : "—"}
            </strong>
            {/* RH-007 (2026-05-24):mobile 沒 hover 看不到 title — 把「部分」做成 visible 註解,
                跟 strong 同 row,語意明確且 SR / 觸控都能取得
                HD-CODEX-004 round 1 (2026-05-25):從 inline style 改成 .tdrw-run-meta-partial class,
                  token / dark mode 一致管理。 */}
            {summary.costPartial && (
              <span className="tdrw-run-meta-partial">(部分)</span>
            )}
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

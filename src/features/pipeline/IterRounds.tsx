import type { IterRound } from "../../types/pipeline";
import { fmtElapsed, normalizeVerdict } from "../../data/pipelines";

export function IterRounds({ rounds }: { rounds: IterRound[] }) {
  return (
    <div className="tdrw-iter-rounds">
      {rounds.map((r) => {
        const n = normalizeVerdict(r.criticVerdict);
        const cls =
          n === "PASS"
            ? "is-pass"
            : n === "FAIL"
            ? "is-fail"
            : "is-partial";
        // td-012:PASS / FAIL 顯示中文化標籤(domain term Runner / commit / branch 保留英文,
        // 但審核結果 verdict 是純語意判定,翻譯不影響領域語)
        const verdictLabel = n === "PASS" ? "通過" : n === "FAIL" ? "失敗" : r.criticVerdict;
        const dur =
          r.endedAt && r.startedAt
            ? fmtElapsed(Math.round((r.endedAt - r.startedAt) / 1000))
            : "—";
        return (
          <div key={r.n} className="tdrw-iter-round">
            <div className="tdrw-iter-round-head">
              <span className="mono tdrw-iter-round-n">#{r.n}</span>
              <span
                className={"tdrw-iter-verdict " + cls}
                title={r.criticVerdict}
                aria-label={`審核結果 ${verdictLabel}(原值 ${r.criticVerdict})`}
              >
                {verdictLabel}
              </span>
              <span className="mono tdrw-iter-round-dur">{dur}</span>
            </div>
            {r.executorSummary && (
              <div className="tdrw-iter-round-block">
                <div className="tdrw-iter-round-label">執行 AI 摘要</div>
                <div className="tdrw-text">{r.executorSummary}</div>
              </div>
            )}
            {/* 審核 block 永遠顯,空 feedback 顯 placeholder(PASS 時 runner prompt 允許省略 feedback,
                若 UI 整段隱掉,user 會誤以為審核沒跑) */}
            <div className="tdrw-iter-round-block">
              <div className="tdrw-iter-round-label">審核 AI 回饋</div>
              {r.criticFeedback ? (
                <div className="tdrw-text">{r.criticFeedback}</div>
              ) : (
                <div className="tdrw-text tdrw-feedback-empty">
                  {n === "PASS" ? "（通過，無補充意見）" : "（無 feedback）"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import type { IterRound } from "../../../../shared/types";
import { fmtElapsed, normalizeVerdict } from "../../../lib/pipelines";

export function IterRounds({ rounds }: { rounds: IterRound[] }) {
  return (
    <div className="tdrw-iter-rounds">
      {rounds.map((r) => {
        // 一輪要寫了 endedAt 才算審核完成;之前(stage doer/critic)是「審核中」,
        // 不顯示佔位 verdict(否則會誤顯成 PARTIAL)。
        const pending = !r.endedAt;
        const n = normalizeVerdict(r.criticVerdict);
        const cls = pending
          ? "is-pending"
          : n === "PASS"
          ? "is-pass"
          : n === "FAIL"
          ? "is-fail"
          : "is-partial";
        // td-012:PASS / FAIL 顯示中文化標籤(verdict 是純語意判定,翻譯不影響領域語)
        const verdictLabel = pending
          ? "審核中"
          : n === "PASS"
          ? "通過"
          : n === "FAIL"
          ? "失敗"
          : r.criticVerdict;
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
                title={pending ? "審核中" : r.criticVerdict}
                aria-label={pending ? "審核結果尚未產生(審核中)" : `審核結果 ${verdictLabel}(原值 ${r.criticVerdict})`}
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
                  {pending ? "（審核中…）" : n === "PASS" ? "（通過，無補充意見）" : "（無 feedback）"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

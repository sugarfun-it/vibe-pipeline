import { normalizeVerdict } from "../../data/pipelines";
import type { IterStage, TicketStatus } from "../../types/pipeline";

export const STAGE_LABEL: Record<IterStage, string> = {
  doer: "執行",
  critic: "審核",
  "✓": "結果",
  done: "結果",
};

// 顯示 PASS/FAIL/PARTIAL 簡短版,擺在「結果」階段裡。base 走 normalizeVerdict,
// 這層只負責 UNKNOWN→? 與 PARTIAL→PART 的顯示縮寫。
export function fmtVerdict(v: unknown): string {
  const n = normalizeVerdict(v);
  if (n === "UNKNOWN") return "?";
  if (n === "PARTIAL") return "PART";
  return n;
}

export function IterStages({
  stage,
  status,
  stages = ["doer", "critic", "✓"],
  lastVerdict,
}: {
  stage: IterStage;
  status: TicketStatus;
  stages?: IterStage[];
  lastVerdict?: unknown;
}) {
  // runner 可能寫不同字面("executing" / "reviewing" / "done" 等),做同義 normalize
  const raw = String(stage);
  const normalized: IterStage =
    raw === "doer" || raw === "critic" || raw === "✓"
      ? (raw as IterStage)
      : raw === "done" || /done|complete|pass|finish|✓/i.test(raw)
      ? "✓"
      : /crit|review|judge|check/i.test(raw)
      ? "critic"
      : /exec|run|do|work/i.test(raw)
      ? "doer"
      : "doer";
  // stages 可能不含 critic(merge / sync 走 ["doer", "✓"]);如果 stage 落不到 stages 裡,fallback 到 doer 避免全顯 ?
  let idx = stages.indexOf(normalized === "done" ? "✓" : normalized);
  if (idx === -1) idx = 0;
  return (
    <div className="iter-stages">
      {stages.map((s, i) => {
        const isPast = i < idx;
        const isCurrent = i === idx;
        const isFuture = i > idx;
        const isResult = s === "✓"; // 結果階段
        // 結果階段的內容:past 用 ✓、current 顯示 verdict(critic 已收尾)、future 用 ?
        let mark: { text: string; cls: string } | null = null;
        if (isPast) {
          mark = { text: "✓", cls: "is-past-mark" };
        } else if (isCurrent) {
          if (isResult) {
            const v = fmtVerdict(lastVerdict);
            mark = { text: v, cls: "is-result-" + v.toLowerCase() };
          } else if (status === "running") {
            mark = { text: "▶", cls: "is-running" };
          } else if (status === "paused") {
            mark = { text: "⏸", cls: "is-paused" };
          }
        } else if (isFuture) {
          mark = { text: "?", cls: "is-future-mark" };
        }
        return (
          <span key={s} style={{ display: "contents" }}>
            <span
              className={
                "iter-stage" +
                (isPast ? " is-past" : "") +
                (isCurrent ? " is-active" : "") +
                (isFuture ? " is-future" : "") +
                (status === "paused" && isCurrent ? " is-paused" : "")
              }
            >
              {STAGE_LABEL[s]}
              {mark && (
                <span className={"iter-stage-mark " + mark.cls} aria-hidden>
                  {mark.text}
                </span>
              )}
            </span>
            {i < stages.length - 1 && <span className="iter-stage-arrow">→</span>}
          </span>
        );
      })}
    </div>
  );
}

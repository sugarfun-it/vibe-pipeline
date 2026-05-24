import { memo } from "react";
import { normalizeVerdict } from "../../data/pipelines";
import { ArrowRightIcon } from "../../ui/icons";
import type { IterStage, TicketStatus } from "../../types/pipeline";

export const STAGE_LABEL: Record<IterStage, string> = {
  doer: "執行",
  critic: "審核",
  "✓": "結果",
  done: "結果",
};

// 顯示 PASS/FAIL/PARTIAL 簡短版,擺在「結果」階段裡。base 走 normalizeVerdict,
// 這層只負責 UNKNOWN→? 與 PARTIAL→PART 的顯示縮寫。
// 9px chip 用英文大寫(CJK 在此尺寸難辨識)。
export function fmtVerdict(v: unknown): string {
  const n = normalizeVerdict(v);
  if (n === "UNKNOWN") return "?";
  if (n === "PARTIAL") return "PART";
  return n;
}

export const IterStages = memo(function IterStages({
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
  // a11y:整段給 SR 一個簡短描述。
  const currentName = STAGE_LABEL[stages[idx] ?? "doer"];
  const isResultStage = stages[idx] === "✓";
  const statusText = status === "running"
    ? "執行中"
    : status === "paused"
    ? "已暫停"
    : status === "done"
    ? "已完成"
    : "";
  const resultText = isResultStage ? `,結果:${fmtVerdict(lastVerdict)}` : "";
  const ariaSummary = `目前階段:${currentName}${statusText ? `,狀態:${statusText}` : ""}${resultText}`;
  return (
    <div className="iter-stages" role="group" aria-label={ariaSummary}>
      {stages.map((s, i) => {
        const isPast = i < idx;
        const isCurrent = i === idx;
        const isFuture = i > idx;
        const isResult = s === "✓"; // 結果階段
        // 結果階段的內容:past 用 ✓、current 顯示 verdict(critic 已收尾)、future 用 ?
        let mark: { text: string; cls: string; srLabel?: string } | null = null;
        if (isPast) {
          mark = { text: "✓", cls: "is-past-mark", srLabel: "完成" };
        } else if (isCurrent) {
          if (isResult) {
            const v = fmtVerdict(lastVerdict);
            const verdictLabel =
              v === "PASS" ? "通過" :
              v === "FAIL" ? "未通過" :
              v === "PART" ? "部分通過" :
              "結果未知";
            mark = { text: v, cls: "is-result-" + v.toLowerCase(), srLabel: verdictLabel };
          } else if (status === "running") {
            mark = { text: "▶", cls: "is-running", srLabel: "執行中" };
          } else if (status === "paused") {
            mark = { text: "⏸", cls: "is-paused", srLabel: "已暫停" };
          }
        } else if (isFuture) {
          mark = { text: "?", cls: "is-future-mark", srLabel: "待進行" };
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
                <>
                  <span className={"iter-stage-mark " + mark.cls} aria-hidden>
                    {mark.text}
                  </span>
                  {mark.srLabel && (
                    <span className="sr-only">{` ${mark.srLabel}`}</span>
                  )}
                </>
              )}
            </span>
            {i < stages.length - 1 && <span aria-hidden className="iter-stage-arrow"><ArrowRightIcon /></span>}
          </span>
        );
      })}
    </div>
  );
});

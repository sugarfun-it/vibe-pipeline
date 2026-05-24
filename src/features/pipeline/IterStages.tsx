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

// TICKET-SG-001 / TICKET-005 / TICKET-SG-006:visible verdict 改本地化(zh-TW)+ 完整動詞語意。
// 過去用 PASS / FAIL / PART 英文 token 跟整體中文 UI 不一致;這層維持 normalizeVerdict
// 給 className / aria 用,但顯示文字一律走中文。PART 用 `部分通過` 而非 `部分`,確保 chip 文字
// 不需依賴 sr-only 才能溝通結果語意(`結果 部分` 易誤讀)。iter-stages 已 flex-wrap,4 字仍能 fit。
export function fmtVerdict(v: unknown): string {
  const n = normalizeVerdict(v);
  if (n === "UNKNOWN") return "未知";
  if (n === "PARTIAL") return "部分通過";
  if (n === "PASS") return "通過";
  if (n === "FAIL") return "失敗";
  return String(v);
}
// 內部 token(class / aria 用)— 保持英文穩定 enum
function verdictToken(v: unknown): string {
  const n = normalizeVerdict(v);
  if (n === "UNKNOWN") return "unknown";
  if (n === "PARTIAL") return "part";
  if (n === "PASS") return "pass";
  if (n === "FAIL") return "fail";
  return "unknown";
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
            const tok = verdictToken(lastVerdict);
            const verdictLabel =
              tok === "pass" ? "通過" :
              tok === "fail" ? "未通過" :
              tok === "part" ? "部分通過" :
              "結果未知";
            mark = { text: v, cls: "is-result-" + tok, srLabel: verdictLabel };
          } else if (status === "running") {
            mark = { text: "▶", cls: "is-running", srLabel: "執行中" };
          } else if (status === "paused") {
            mark = { text: "⏸", cls: "is-paused", srLabel: "已暫停" };
          } else if (status === "failed" || status === "failed_iter_limit" || status === "failed_transient") {
            // TG-404:terminal failed 卡片仍在某個 stage 中段失手時(round 未完成),
            // current stage 不該繼續使用 active 強調色而沒 mark — 容易被誤讀成「正在跑」。
            // 改顯 ✕ failure mark + dim 樣式,跟 done/paused 一樣讓 mark 直接溝通結果。
            mark = { text: "✕", cls: "is-failed-mark", srLabel: "失敗" };
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

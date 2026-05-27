import type { Draft, TicketSpec } from "../../api/qa";

export const FIRST_AI_MESSAGE = "描述需求、完成標準與限制條件，我會整理成需求單規格。";
export const FIRST_AI_OPTIONS = [
  "建立功能需求",
  "整理錯誤回報",
  "盤點可建立的需求單",
];
export const BOOTSTRAP_LABEL = "啟動需求整理";

export function isSpecComplete(s: Partial<TicketSpec> | null): boolean {
  if (!s) return false;
  return (
    !!s.title &&
    !!s.goal &&
    Array.isArray(s.acceptance) &&
    s.acceptance.length > 0 &&
    !!s.prompt &&
    (s.mode === "step" || s.mode === "iter")
  );
}

export function lastAiOptions(
  draft: Draft | null
): { options: string[]; mode: "single" | "multi" } {
  if (!draft) return { options: [], mode: "single" };
  if (draft.turns.length === 0) return { options: FIRST_AI_OPTIONS, mode: "single" };
  const last = draft.turns[draft.turns.length - 1];
  if (last.role !== "ai") return { options: [], mode: "single" };
  return { options: last.options ?? [], mode: last.optionsMode ?? "single" };
}

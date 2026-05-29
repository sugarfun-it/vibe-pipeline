import { useEffect, useState } from "react";
import type { Draft } from "../../api/qa";
import { isSpecComplete } from "./qaDrawerUtils";

export function useQAViewState(draft: Draft | null) {
  // View override:user 顯式選擇要看哪個視圖,蓋過 draft.complete 自動切的邏輯。
  // - "chat" :user 在 SpecReview 點「繼續討論」,即使 draft.complete=true 也回 chat
  // - "review":user 在 chat 點「回最終預覽」,即使 draft.complete=false 也跳預覽(spec 仍須 5/5)
  // - null :跟 draft.complete 自動切
  // 切 draft(draftId 變)清掉
  const [viewOverride, setViewOverride] = useState<"chat" | "review" | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: draftId is the intentional reset trigger
  useEffect(() => {
    setViewOverride(null);
  }, [draft?.draftId]);

  const specComplete = isSpecComplete(draft?.spec ?? null);
  // 最終 review 視圖條件:spec 5/5 齊,且(override="review" 或 draft.complete=true 且未 override="chat")
  const showReview =
    specComplete &&
    (viewOverride === "review" || (draft?.complete === true && viewOverride !== "chat"));
  const hasAnyTurn = (draft?.turns.length ?? 0) > 0;
  // 空狀態:剛開 drawer 還沒任何對話 — 不顯示一排灰色 checklist,避免把首次體驗變成「驗證失敗」表
  const showChecklist = !!draft && (hasAnyTurn || specComplete);

  return {
    specComplete,
    showReview,
    hasAnyTurn,
    showChecklist,
    setViewOverride,
  };
}

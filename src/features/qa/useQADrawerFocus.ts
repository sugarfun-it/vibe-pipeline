import { useEffect } from "react";
import type { Draft } from "../../api/qa";

export function useQADrawerFocus({
  draft,
  showReview,
  composerInputRef,
}: {
  draft: Draft | null;
  showReview: boolean;
  composerInputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  // a11y:對話建立流程開場焦點應落在輸入區,而不是「關閉」按鈕。
  // Overlay initialFocus="root" 後立即把焦點推給 composer textarea(若 draft 已存在且非 review 視圖)。
  // 切草稿 / 切視圖會再觸發。restoreFocus 由 Overlay 卸載時負責還給 opener。
  useEffect(() => {
    if (!draft) return;
    if (showReview) return;
    const id = requestAnimationFrame(() => {
      composerInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [draft?.draftId, showReview]);
}

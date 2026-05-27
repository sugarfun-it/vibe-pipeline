import { useEffect, useRef } from "react";
import type { Draft } from "../../api/qa";

export function useTranscriptScroll({
  draft,
  showReview,
  transcriptRef,
}: {
  draft: Draft | null;
  showReview: boolean;
  transcriptRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  // turns 增加 / 切回 chat 視圖時自動 scroll 到底,但首次掛載一律 anchor 頂(welcome bubble 完整可見),
  // 避免 mid-bubble 卡在 body 頂端產生視覺切斷感。user 想看歷史末段自己捲;新 turn 之後跟著黏底
  // showReview=true 期間 transcriptRef 沒掛(SpecReview 渲染);切回 chat 後新 ref 掛上才 scroll
  const prevTurnsLenRef = useRef<number>(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: draftId 變(切草稿)reset
  useEffect(() => {
    prevTurnsLenRef.current = -1;
  }, [draft?.draftId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns.length / showReview 是觸發訊號
  useEffect(() => {
    if (showReview) return;
    const turnsLen = draft?.turns.length ?? 0;
    const prev = prevTurnsLenRef.current;
    prevTurnsLenRef.current = turnsLen;
    const id = requestAnimationFrame(() => {
      const el = transcriptRef.current;
      if (!el) return;
      // 首次掛載(prev===-1):一律 scroll 頂,welcome bubble 完整 + 後面對話展開狀讓 user 自己捲
      // 後續 turn 增加(prev≥0 且 turnsLen>prev):scroll 到底跟著新訊息(chat 慣例)
      if (prev === -1) {
        el.scrollTo({ top: 0 });
        return;
      }
      if (turnsLen > prev) el.scrollTo({ top: el.scrollHeight });
    });
    return () => cancelAnimationFrame(id);
  }, [draft?.turns.length, draft?.draftId, showReview]);
}

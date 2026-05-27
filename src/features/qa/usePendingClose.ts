import { useEffect, useRef, useState } from "react";

export function usePendingClose({
  composerTextRef,
  onClose,
}: {
  composerTextRef: React.MutableRefObject<string>;
  onClose: () => void;
}) {
  // 未送出文字確認用 in-drawer 彈窗(不用 window.confirm,避免破壞抽屜視覺一致)
  const [pendingClose, setPendingClose] = useState(false);
  const pendingCancelBtnRef = useRef<HTMLButtonElement>(null);
  const requestClose = () => {
    if (composerTextRef.current.trim().length > 0) {
      setPendingClose(true);
      return;
    }
    onClose();
  };
  // pendingClose:把焦點推到「繼續編輯」(預設安全動作 = 留下);
  // 同時 ESC 在 pending 期間視為「繼續編輯」(避免 ESC 再次 requestClose 進無限迴圈)
  useEffect(() => {
    if (!pendingClose) return;
    const id = requestAnimationFrame(() => {
      pendingCancelBtnRef.current?.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPendingClose(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [pendingClose]);

  return {
    pendingClose,
    setPendingClose,
    pendingCancelBtnRef,
    requestClose,
  };
}

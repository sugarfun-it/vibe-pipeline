import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// ProjectPickerContext — 跨 TopBar / EmptyProject(以及其他想觸發 browse modal 的 surface)
// 共用 browse modal open state。狀態本體(browseOpen)留在 context;modal 內部 fetch / focus
// trap / keyboard 仍由 TopBar 管(透過觀察 browseOpen 轉換 false→true 自動觸發 initial load),
// 所以 context API 維持窄面:只有 open / close + 一個 trigger event 計數。
//
// 為何不把 browseData / loadBrowse 也搬上來:這些是 modal 的 implementation detail,
// EmptyProject 只需要「我要開 browse」這個訊號。把 fetch state 也升到 context 會讓所有
// consumer re-render(每次 loadBrowse 中)且擴大 context 的責任面。
export type ProjectPickerContextValue = {
  browseOpen: boolean;
  setBrowseOpen: (v: boolean) => void;
  openBrowse: () => void;
  // 給 TopBar 的訊號:openBrowse() 被呼叫第 N 次。TopBar effect 依此 trigger initial fetch,
  // 即使 browseOpen 從 true→true(已開時再點)也能重打 root listing。
  openRequestNonce: number;
};

const Ctx = createContext<ProjectPickerContextValue | null>(null);

export function ProjectPickerProvider({ children }: { children: ReactNode }) {
  const [browseOpen, setBrowseOpen] = useState(false);
  const [openRequestNonce, setOpenRequestNonce] = useState(0);

  const openBrowse = useCallback(() => {
    setBrowseOpen(true);
    setOpenRequestNonce((n) => n + 1);
  }, []);

  const value = useMemo<ProjectPickerContextValue>(
    () => ({ browseOpen, setBrowseOpen, openBrowse, openRequestNonce }),
    [browseOpen, openBrowse, openRequestNonce],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectPicker(): ProjectPickerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProjectPicker 要在 ProjectPickerProvider 內用");
  return v;
}

import { useCallback, useState } from "react";

export function useBoardTabs(setActiveId: (id: string) => void) {
  const [activeTab, setActiveTab] = useState<"rail" | "focus">("focus");
  const switchToRail = useCallback(() => setActiveTab("rail"), []);
  const switchToFocus = useCallback(() => setActiveTab("focus"), []);
  const handleSelectPipeline = useCallback((id: string) => {
    setActiveId(id);
    setActiveTab("focus");
  }, [setActiveId]);

  return {
    activeTab,
    setActiveTab,
    switchToRail,
    switchToFocus,
    handleSelectPipeline,
  };
}

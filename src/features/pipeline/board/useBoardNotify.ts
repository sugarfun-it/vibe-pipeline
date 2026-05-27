import { useCallback } from "react";

export function useBoardNotify(setActionError: (msg: string | null) => void) {
  // notify* — 統一寫 setActionError(toast)。透過 Context 暴露給深層子組件,不再 props drill。
  const error = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);
  const warn = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);
  const info = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);

  return { error, warn, info };
}

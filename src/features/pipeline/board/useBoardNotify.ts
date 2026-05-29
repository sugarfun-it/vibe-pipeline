import { useCallback } from "react";

export function useBoardNotify(setActionError: (msg: string | null) => void) {
  // notify* — 統一寫 setActionError(toast)。透過 Context 暴露給深層子組件,不再 props drill。
  // biome-ignore lint/correctness/useExhaustiveDependencies: setActionError is a stable setter; notify callbacks intentionally kept stable
  const error = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: setActionError is a stable setter; notify callbacks intentionally kept stable
  const warn = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: setActionError is a stable setter; notify callbacks intentionally kept stable
  const info = useCallback((msg: string, _opts?: { sub?: string; pipelineId?: string }) => {
    setActionError(msg);
  }, []);

  return { error, warn, info };
}

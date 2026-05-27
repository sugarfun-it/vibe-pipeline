import { useCallback, useState } from "react";
import { useTimeout } from "../../../hooks/useTimeout";
import { useUrlParam } from "../../../hooks/useUrlParam";

export function useActivePipeline() {
  const [activeIdRaw, setActiveIdParam] = useUrlParam("pipeline", { push: true });
  const activeId = activeIdRaw ?? "";
  const setActiveId = useCallback(
    (next: string | ((prev: string) => string)) => {
      const resolved = typeof next === "function" ? next(activeId) : next;
      if (resolved === activeId) return;
      setActiveIdParam(resolved || null);
    },
    [activeId, setActiveIdParam],
  );
  const [hashGraceExpired, setHashGraceExpired] = useState(false);
  useTimeout(() => setHashGraceExpired(true), 200);

  return {
    activeIdRaw,
    activeId,
    setActiveId,
    hashGraceExpired,
  };
}

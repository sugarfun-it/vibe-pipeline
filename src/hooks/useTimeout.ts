import { useEffect, useRef } from "react";

export function useTimeout(fn: () => void, ms: number | null, deps: ReadonlyArray<unknown> = []) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    if (ms === null) return;
    const id = setTimeout(() => {
      fnRef.current();
    }, ms);
    return () => clearTimeout(id);
    // biome-ignore lint/correctness/useExhaustiveDependencies: ms + caller deps 為刻意 trigger
  }, [ms, ...deps]);
}

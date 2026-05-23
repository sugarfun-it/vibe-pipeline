import { useCallback, useEffect } from "react";
import { useUrlParam } from "./useUrlParam";
import { useLocalStorageState } from "./useLocalStorageState";

const LS_KEY = "vibe-pipeline:lastProjectHash";

export function useActiveProjectHash(): {
  hash: string | null;
  setHash: (next: string | null) => void;
} {
  const [urlHash, setUrlHash] = useUrlParam("project");
  const [fallback, setFallback] = useLocalStorageState<string | null>(LS_KEY, null);

  // URL 有值 → 寫進 LS 當下次 mount 的 fallback(refresh / 直接打 /board 不丟)
  useEffect(() => {
    if (urlHash && urlHash !== fallback) {
      setFallback(urlHash);
    }
  }, [urlHash, fallback, setFallback]);

  const setHash = useCallback(
    (next: string | null) => {
      setUrlHash(next);
      setFallback(next);
    },
    [setUrlHash, setFallback],
  );

  return { hash: urlHash ?? fallback, setHash };
}

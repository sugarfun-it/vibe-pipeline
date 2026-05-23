import { useCallback, useState } from "react";
import { useTimeout } from "./useTimeout";

export function useCopiedFeedback(durationMs: number = 1500) {
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  useTimeout(
    () => setCopied(false),
    copied ? durationMs : null,
    [tick],
  );

  const flash = useCallback(() => {
    setCopied(true);
    setTick((n) => n + 1);
  }, []);

  return { copied, flash };
}

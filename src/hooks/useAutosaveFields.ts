import { useEffect, useRef } from "react";

export const AUTOSAVE_DELAY_MS = 400;

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

// Shared per-field autosave scheduler. Each field is keyed by a string; the hook
// owns the debounce timers, in-flight abort controllers, and a monotonically
// increasing seq per key so stale responses can be ignored. Both ProjectTab and
// useUserConfig consume this so their confirmed-value rollback logic stays the
// single source of truth — the rollback callback fires only for the latest seq
// and only on non-abort errors, identical to the previous inline copies.
export function useAutosaveFields<K extends string>() {
  const timersRef = useRef<Partial<Record<K, ReturnType<typeof setTimeout>>>>({});
  const controllersRef = useRef<Partial<Record<K, AbortController>>>({});
  const seqRef = useRef<Partial<Record<K, number>>>({});

  function isCurrentSeq(key: K, seq: number): boolean {
    return seqRef.current[key] === seq;
  }

  function scheduleAutosave(
    key: K,
    run: (signal: AbortSignal, seq: number) => Promise<void>,
    rollback: (e: unknown) => void
  ) {
    const seq = (seqRef.current[key] ?? 0) + 1;
    seqRef.current[key] = seq;
    const existingTimer = timersRef.current[key];
    if (existingTimer) clearTimeout(existingTimer);
    timersRef.current[key] = setTimeout(() => {
      controllersRef.current[key]?.abort();
      const controller = new AbortController();
      controllersRef.current[key] = controller;
      run(controller.signal, seq)
        .catch((e: unknown) => {
          if (seqRef.current[key] !== seq || isAbortError(e)) return;
          rollback(e);
        })
        .finally(() => {
          if (controllersRef.current[key] === controller) delete controllersRef.current[key];
        });
    }, AUTOSAVE_DELAY_MS);
  }

  useEffect(() => {
    const timers = timersRef.current;
    const controllers = controllersRef.current;
    return () => {
      for (const timer of Object.values(timers)) {
        if (timer) clearTimeout(timer as ReturnType<typeof setTimeout>);
      }
      for (const controller of Object.values(controllers)) {
        (controller as AbortController | undefined)?.abort();
      }
    };
  }, []);

  return { scheduleAutosave, isCurrentSeq };
}

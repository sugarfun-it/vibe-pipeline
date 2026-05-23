import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncActionState = {
  pending: boolean;
  error: Error | null;
  reset: () => void;
};

export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): [
  (...args: TArgs) => Promise<TResult | undefined>,
  AsyncActionState,
] {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    setError(null);
  }, []);

  const run = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    if (pendingRef.current) return undefined;
    pendingRef.current = true;
    if (mountedRef.current) {
      setPending(true);
      setError(null);
    }
    try {
      const result = await fnRef.current(...args);
      if (mountedRef.current) {
        setError(null);
      }
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (mountedRef.current) {
        setError(err);
      }
      return undefined;
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) {
        setPending(false);
      }
    }
  }, []);

  return [run, { pending, error, reset }];
}

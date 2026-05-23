import { useEffect, useState } from "react";
import { authedFetch } from "./authApi";
import { useToast } from "../../ui/Toast";
import type { AuthStatus } from "./types";

type AuthEnvelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

export function useAuthStatus(): {
  status: AuthStatus | null;
  loading: boolean;
  refetch: () => void;
} {
  const { toast } = useToast();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authedFetch("/api/auth/status")
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as AuthEnvelope<AuthStatus>;
        if (cancelled) return;
        if (body.ok && body.data) {
          setStatus(body.data);
        } else {
          setStatus({ bound: false });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus({ bound: false });
        toast(`讀取登入狀態失敗:${e instanceof Error ? e.message : String(e)}`, { variant: "danger" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick, toast]);

  return { status, loading, refetch: () => setTick((n) => n + 1) };
}

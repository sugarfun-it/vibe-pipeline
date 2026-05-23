import { useEffect } from "react";
import { authedFetch } from "./authApi";
import { useToast } from "../../ui/Toast";
import { useApi } from "../../hooks/useApi";
import type { AuthStatus } from "./types";

type AuthEnvelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

export function useAuthStatus(): {
  status: AuthStatus | null;
  loading: boolean;
  refetch: () => void;
} {
  const { toast } = useToast();

  const { data, error, refetch } = useApi<AuthStatus>(
    async () => {
      const res = await authedFetch("/api/auth/status");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as AuthEnvelope<AuthStatus>;
      if (body.ok && body.data) return body.data;
      return { bound: false } as AuthStatus;
    },
    { refetchOnVisible: false }
  );

  useEffect(() => {
    if (error) {
      toast(`讀取登入狀態失敗:${error.message}`, { variant: "danger" });
    }
  }, [error, toast]);

  // error 時用 fallback {bound:false},維持原本行為
  const status: AuthStatus | null = data ?? (error ? { bound: false } : null);
  const loading = data === null && error === null;

  return { status, loading, refetch };
}

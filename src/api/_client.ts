import type { ApiResponse, ApiErrorCode } from "../../shared/types";

export class ApiError extends Error {
  constructor(public code: ApiErrorCode | string, message: string) {
    super(message);
  }
}

type CallInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

// 共用 authed fetch:相對 path 自動補 API_BASE_URL；credentials:include 帶 cookie。
// 401 → 自動跳 /login?returnTo=<current>(setup / login 頁不跳,避開無限 loop)。
// 雷:這條 redirect 是 session 過期自動跳登入的唯一路徑,改它前確認沒斷。
export async function authedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === "string" && input.startsWith("/")
      ? `${API_BASE_URL}${input}`
      : input;
  const res = await fetch(url, { ...init, credentials: "include" });
  if (res.status === 401) {
    if (
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login") &&
      !window.location.pathname.startsWith("/setup")
    ) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnTo=${returnTo}`;
    }
    return res;
  }
  return res;
}

// 共用 fetch wrapper:body 為 object 自動 JSON.stringify + 帶 utf-8 charset header(防 cp950 mojibake);
// 拆 ApiResponse 失敗 throw ApiError。回傳 data 已 narrow 成 T,呼叫端不用再判 ok。
export async function call<T>(path: string, init?: CallInit): Promise<T> {
  const opts: RequestInit = { method: init?.method, headers: init?.headers, signal: init?.signal };
  if (init?.body !== undefined) {
    opts.body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    opts.headers = { "Content-Type": "application/json; charset=utf-8", ...(init.headers || {}) };
  }
  const res = await authedFetch(`${API_BASE_URL}${path}`, opts);
  const json = (await res.json()) as ApiResponse<T> & { data?: T; message?: string };
  if (!json.ok) {
    const message = typeof json.message === "string" ? json.message : json.error.message;
    throw new ApiError(json.error.code, message);
  }
  return json.data as T;
}

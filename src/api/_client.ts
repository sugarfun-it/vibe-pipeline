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

// 共用 fetch:相對 path 自動補 API_BASE_URL；credentials:include 維持 cookie 機制(目前 app 無 auth,
// 但保留 include 讓未來若加任何 cookie-based feature 不必再改 callsite)。
export async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === "string" && input.startsWith("/")
      ? `${API_BASE_URL}${input}`
      : input;
  return fetch(url, { ...init, credentials: "include" });
}

// 共用 fetch wrapper:body 為 object 自動 JSON.stringify + 帶 utf-8 charset header(防 cp950 mojibake);
// 拆 ApiResponse 失敗 throw ApiError。回傳 data 已 narrow 成 T,呼叫端不用再判 ok。
export async function call<T>(path: string, init?: CallInit): Promise<T> {
  const opts: RequestInit = { method: init?.method, headers: init?.headers, signal: init?.signal };
  if (init?.body !== undefined) {
    opts.body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    opts.headers = { "Content-Type": "application/json; charset=utf-8", ...(init.headers || {}) };
  }
  const res = await apiFetch(`${API_BASE_URL}${path}`, opts);
  const json = (await res.json()) as ApiResponse<T> & { data?: T; message?: string };
  if (!json.ok) {
    const message = typeof json.message === "string" ? json.message : json.error.message;
    throw new ApiError(json.error.code, message);
  }
  return json.data as T;
}

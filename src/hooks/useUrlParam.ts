import { useCallback, useSyncExternalStore } from "react";

// useUrlParam — 收斂 URLSearchParams + history.replaceState 散落呼叫。
//
// 設計意圖:
// 6+ 處 component 各自手寫 `new URLSearchParams(location.search)` + `p.set/delete` +
// `history.replaceState` 樣板,容易漏掉「不污染 history」的 replace 預設,或在多 caller
// 間 race(snapshot stale)。本 hook 把單一 key 的讀寫收成 `[value, setValue]` 介面。
//
// 走 native URL API + popstate(原本走 react-router useSearchParams)— 全 app 只一個 route
// (`/board`),拔 react-router-dom 省 ~25KB bundle + 一個 dep,自管 URL state 50 行夠。
//
// 預設 `{ replace: true }` — URL state 大多是「目前畫面狀態」(active project / 開哪張
// ticket / theme override),back 鈕回上一個 state 沒意義,還會堆 history 滾很久才回得了。
// 真要堆 history(例如「上一篇文章」型導覽)時 caller 傳 `{ push: true }`。

export interface UseUrlParamOptions {
  push?: boolean;
}

// 全 app 共用 subscriber set — `history.replaceState` / `pushState` 不會觸發 popstate,
// 自管 setValue 寫進去後要主動通知其他 useUrlParam caller 重 render。
const subscribers = new Set<() => void>();
function notify(): void {
  for (const cb of subscribers) cb();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  window.addEventListener("popstate", cb);
  return () => {
    subscribers.delete(cb);
    window.removeEventListener("popstate", cb);
  };
}

function getSnapshot(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

export function useUrlParam(
  key: string,
  opts: UseUrlParamOptions = {},
): [string | null, (next: string | null) => void] {
  const search = useSyncExternalStore(subscribe, getSnapshot, () => "");
  const value = new URLSearchParams(search).get(key);
  const push = opts.push === true;

  const setValue = useCallback(
    (next: string | null) => {
      const p = new URLSearchParams(window.location.search);
      if (next === null || next === "") p.delete(key);
      else p.set(key, next);
      const qs = p.toString();
      const url = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
      if (push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
      notify();
    },
    [key, push],
  );

  return [value, setValue];
}

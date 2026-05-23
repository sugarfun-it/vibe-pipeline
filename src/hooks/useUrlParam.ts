import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// useUrlParam — 收斂 URLSearchParams / history.pushState / replaceState 散落呼叫
//
// 設計意圖:
// 6+ 處 component 各自手寫 `new URLSearchParams(params)` + `p.set/delete` + `setSearchParams`
// 樣板,容易漏掉「不污染 history」的 replace 預設,或在多 caller 間 race(setSearchParams
// 拿到 stale params snapshot)。本 hook 把單一 key 的讀寫收成 `[value, setValue]` 介面。
//
// 底層走 react-router `useSearchParams` 而非裸 `window.history.replaceState`:
// 1. BrowserRouter 內已監聽自己的 history;裸 history API 寫進去 react-router 的
//    `location` 不會即時更新,其他組件 `useSearchParams` 讀到 stale。
// 2. react-router 已處理 popstate / 跨 hook caller 同步,不需自建 subscriber set。
//
// 預設 `{ replace: true }` — URL state 大多是「目前畫面狀態」(active project / 開哪張
// ticket / theme override),back 鈕回上一個 state 沒意義,還會堆 history 滾很久才回得了。
// 真要堆 history(例如「上一篇文章」型導覽)時 caller 傳 `{ push: true }`。

export interface UseUrlParamOptions {
  push?: boolean;
}

export function useUrlParam(
  key: string,
  opts: UseUrlParamOptions = {},
): [string | null, (next: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key);
  const push = opts.push === true;

  const setValue = useCallback(
    (next: string | null) => {
      const p = new URLSearchParams(params);
      if (next === null || next === "") p.delete(key);
      else p.set(key, next);
      setParams(p, { replace: !push });
    },
    [key, params, push, setParams],
  );

  return [value, setValue];
}

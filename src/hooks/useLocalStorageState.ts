import { useCallback, useEffect, useRef, useState } from "react";

// useLocalStorageState — 收斂 localStorage.getItem/setItem/removeItem + storage event 樣板
//
// 設計意圖:
// 6+ 處 component 散落 `localStorage.getItem(KEY) ?? default` + setter 寫 LS 的 boilerplate,
// 全都漏了「跨 tab 同步」(storage event)跟「quota / parse 失敗 swallow」。本 hook 把這
// 段收斂,並保證:
//   - lazy init(只讀一次 LS,不在每次 render 重讀)
//   - setValue 寫 LS 失敗 swallow(quota / privacy mode)— React state 仍更
//   - storage event 跨 tab 同步(同 origin 其他 tab setItem 時自動更)
//   - 物件型可選 serializer / deserializer(default JSON)
//
// **theme 例外**:本 hook 只同步 React state ↔ localStorage,不負責 set `<html>` className。
// 第一個 frame 的 theme class 仍由 `index.html` inline script 設(避開 useEffect 兩 frame
// 才跑造成的 flash)。caller(TopBar / App)切 theme 時自行 `document.documentElement.classList.toggle`。

export interface UseLocalStorageStateOptions<T> {
  // 不傳預設用 String() / JSON 視 default type 決定
  serialize?: (v: T) => string;
  deserialize?: (s: string) => T;
}

export function useLocalStorageState<T extends string | null>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void];
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  opts: UseLocalStorageStateOptions<T>,
): [T, (next: T) => void];
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  opts: UseLocalStorageStateOptions<T> = {},
): [T, (next: T) => void] {
  const isStringDefault = typeof defaultValue === "string" || defaultValue === null;
  const serialize = opts.serialize ?? ((v: T) => (isStringDefault ? (v as unknown as string) : JSON.stringify(v)));
  const deserialize =
    opts.deserialize ??
    ((s: string) => (isStringDefault ? (s as unknown as T) : (JSON.parse(s) as T)));

  // biome-ignore lint/correctness/useExhaustiveDependencies: defaultValue/deserialize treated as stable, same as storage-event effect below
  const readKey = useCallback(
    (k: string): T => {
      try {
        const raw = localStorage.getItem(k);
        if (raw === null) return defaultValue;
        return deserialize(raw);
      } catch {
        return defaultValue;
      }
    },
    [],
  );

  const [value, setValueState] = useState<T>(() => readKey(key));

  // key 動態變動時重讀新 key 的 LS 值(value 的 lazy init 只在 mount 跑一次)。
  // ref 記前一個 key,skip mount(initializer 已讀過 mount 時的 key),只在 key 真的換掉時 resync。
  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    setValueState(readKey(key));
  }, [key, readKey]);

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      try {
        if (next === null || next === undefined) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, serialize(next));
        }
      } catch {
        // quota / privacy mode — memory state 仍更
      }
    },
    [key, serialize],
  );

  // 跨 tab 同步:其他 tab setItem(key) → window 收到 storage event
  // (同 tab 內 setItem 不會 fire 自己的 storage event,所以 setValue 走 setValueState 直接更)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only key triggers re-bind; defaultValue/deserialize treated as stable
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== key) return;
      if (e.newValue === null) {
        setValueState(defaultValue);
        return;
      }
      try {
        setValueState(deserialize(e.newValue));
      } catch {
        // ignore — 其他 tab 寫壞資料就 stale,不崩 UI
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // defaultValue / deserialize 視為穩定;只重綁 key
  }, [key]);

  return [value, setValue];
}

import { useEffect, useState } from "react";
import { Workbox } from "workbox-window";
import { useApi } from "../hooks/useApi";

type Listener = (value: boolean) => void;

let wb: Workbox | null = null;
let needRefreshState = false;
let offlineReadyState = false;
const needRefreshListeners = new Set<Listener>();
const offlineReadyListeners = new Set<Listener>();
let initialized = false;

function setNeedRefresh(value: boolean) {
  needRefreshState = value;
  for (const fn of needRefreshListeners) fn(value);
}

function setOfflineReady(value: boolean) {
  offlineReadyState = value;
  for (const fn of offlineReadyListeners) fn(value);
}

type RegisterOpts = {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
};

export function registerSW(opts: RegisterOpts = {}) {
  if (initialized) return;
  initialized = true;

  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const swUrl = "/firebase-messaging-sw.js";
  // 明指 type:'classic' — SW build 用 IIFE format(vite.config.ts injectManifest.rollupFormat:'iife'),
  // 內含 importScripts() 載 firebase compat,只能在 classic SW 內合法。workbox-window 預設可能改 module 撞炸
  wb = new Workbox(swUrl, { type: "classic" });

  wb.addEventListener("waiting", () => {
    setNeedRefresh(true);
    opts.onNeedRefresh?.();
  });

  wb.addEventListener("activated", (event) => {
    if (!event.isUpdate) {
      setOfflineReady(true);
      opts.onOfflineReady?.();
    }
  });

  // controlling event fires on:
  //   1. first install(沒前任 controller)— 不該 reload!整頁重 mount 觸發 N 個 endpoint 二度 fire
  //   2. update + skipWaiting(user 點「更新」)— 該 reload 拿新 bundle
  // 用 navigator.serviceWorker.controller(register 前快照)判斷:null = 沒前任 = first install
  const hadController = !!navigator.serviceWorker.controller;
  wb.addEventListener("controlling", () => {
    if (hadController) window.location.reload();
  });

  wb.register().catch((err) => {
    console.error("[swUpdate] register failed", err);
  });

  // workbox-window 預設只在 register 那一次 check update。
  // 切回 visible 時 check 一次(切 app 回來)。長期開著的 60s polling
  // 由 useSwUpdate hook 透過 useApi 處理(享 visibility / freeze 雙保險)。
  const checkUpdate = () => {
    if (wb && document.visibilityState === "visible") {
      wb.update().catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", checkUpdate);
}

function checkSwUpdate(): Promise<void> {
  if (wb && document.visibilityState === "visible") {
    return wb.update().then(() => undefined).catch(() => undefined);
  }
  return Promise.resolve();
}

export function updateSW() {
  if (!wb) {
    window.location.reload();
    return;
  }
  wb.messageSkipWaiting();
}

export function useSwUpdate() {
  const [needRefresh, setNeed] = useState(needRefreshState);
  const [offlineReady, setOffline] = useState(offlineReadyState);

  useEffect(() => {
    const nFn: Listener = (v) => setNeed(v);
    const oFn: Listener = (v) => setOffline(v);
    needRefreshListeners.add(nFn);
    offlineReadyListeners.add(oFn);
    setNeed(needRefreshState);
    setOffline(offlineReadyState);
    return () => {
      needRefreshListeners.delete(nFn);
      offlineReadyListeners.delete(oFn);
    };
  }, []);

  // 60s polling check SW update — useApi 已處理 visibility / freeze
  useApi<void>(checkSwUpdate, { intervalMs: 60_000, refetchOnVisible: false });

  return {
    needRefresh,
    offlineReady,
    updateSW,
  };
}

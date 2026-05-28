import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
  type MessagePayload,
} from "firebase/messaging";
import { registerPush, unregisterPush } from "../api/push";

type FcmConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
};

const TOKEN_KEY = "fcm_token";

// Firebase Web SDK config default:maintainer host(專案 `vibe-pipeline`)的公開 config。
// forker 自架 Firebase → 用 VITE_FCM_* env vars override(build time 注入)。
const DEFAULT_FCM_CONFIG: FcmConfig = {
  apiKey: "AIzaSyAQX2L-rsCaUeNnNOXPIhzXH3kShJR0wTw",
  authDomain: "vibe-pipeline.firebaseapp.com",
  projectId: "vibe-pipeline",
  storageBucket: "vibe-pipeline.firebasestorage.app",
  messagingSenderId: "799841449136",
  appId: "1:799841449136:web:b7d6c6eb44a162feacf775",
  vapidKey:
    "BInL1w91RmBaVvdvQhZt0NnehW0RUeHnDI1dSEx20WUOxPMXVZ2yP-iL4SjROzz531Dl4i_7v5wnzwY9J_GeOd4",
};

function resolveConfig(): FcmConfig {
  return {
    apiKey: import.meta.env.VITE_FCM_API_KEY ?? DEFAULT_FCM_CONFIG.apiKey,
    authDomain: import.meta.env.VITE_FCM_AUTH_DOMAIN ?? DEFAULT_FCM_CONFIG.authDomain,
    projectId: import.meta.env.VITE_FCM_PROJECT_ID ?? DEFAULT_FCM_CONFIG.projectId,
    storageBucket: import.meta.env.VITE_FCM_STORAGE_BUCKET ?? DEFAULT_FCM_CONFIG.storageBucket,
    messagingSenderId:
      import.meta.env.VITE_FCM_MESSAGING_SENDER_ID ?? DEFAULT_FCM_CONFIG.messagingSenderId,
    appId: import.meta.env.VITE_FCM_APP_ID ?? DEFAULT_FCM_CONFIG.appId,
    vapidKey: import.meta.env.VITE_FCM_VAPID_KEY ?? DEFAULT_FCM_CONFIG.vapidKey,
  };
}

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;
let config: FcmConfig | null = null;
let initPromise: Promise<Messaging | null> | null = null;

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getPermission(): NotificationPermission {
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission;
}

export function isFcmSupported(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!("serviceWorker" in navigator) || typeof Notification === "undefined") {
    return Promise.resolve(false);
  }
  return isSupported().catch(() => false);
}

export async function initFCM(): Promise<Messaging | null> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const supported = await isFcmSupported();
      if (!supported) return null;
      const cfg = resolveConfig();
      if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
        console.warn("[fcm] config 缺欄位,跳過初始化");
        return null;
      }
      config = cfg;
      const existing = getApps();
      app =
        existing.length > 0
          ? existing[0]
          : initializeApp({
              apiKey: cfg.apiKey,
              authDomain: cfg.authDomain,
              projectId: cfg.projectId,
              storageBucket: cfg.storageBucket,
              messagingSenderId: cfg.messagingSenderId,
              appId: cfg.appId,
            });
      messaging = getMessaging(app);
      return messaging;
    } catch (e) {
      console.error("[fcm] initFCM 失敗", e);
      return null;
    }
  })();
  return initPromise;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
  if (existing) {
    // 等 SW 變 active(getRegistration 拿到的可能還在 installing / waiting)
    await navigator.serviceWorker.ready;
    return existing;
  }
  await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  // **必須**等到 SW 進入 active 狀態 — Firebase getToken 內部呼叫 PushManager.subscribe,
  // 沒 active SW 會直接 "Subscription failed - no active Service Worker" silent fail。
  // 參考 firebase-js-sdk#7693 race condition fix。
  const ready = await navigator.serviceWorker.ready;
  return ready;
}

export async function requestAndRegisterToken(): Promise<string> {
  const m = await initFCM();
  if (!m || !config) throw new Error("FCM 未初始化(check supported / config)");
  // 先註冊 + 等 SW active,再要 permission + getToken,避免 race condition
  const swReg = await registerServiceWorker();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(`通知權限:${permission}`);
  const token = await getToken(m, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: swReg,
  });
  if (!token) throw new Error("getToken 回空,可能 VAPID / authDomain 不對");
  try {
    await registerPush(token);
  } catch (e) {
    console.warn("[fcm] /api/push/register 失敗,token 仍保留 local:", e);
  }
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
  return token;
}

export async function unregisterToken(): Promise<void> {
  const token = getStoredToken();
  const m = await initFCM();
  if (m) {
    try {
      await deleteToken(m);
    } catch (e) {
      console.warn("[fcm] deleteToken 失敗", e);
    }
  }
  if (token) {
    try {
      await unregisterPush(token);
    } catch (e) {
      console.warn("[fcm] /api/push/unregister 失敗", e);
    }
  }
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function setupForegroundHandler(cb: (payload: MessagePayload) => void): () => void {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  void initFCM().then((m) => {
    if (cancelled || !m) return;
    unsub = onMessage(m, cb);
  });
  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

export type { MessagePayload };

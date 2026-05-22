import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { BoardScreen } from "./features/pipeline/BoardScreen";
import { SetupScreen } from "./features/auth/SetupScreen";
import { LoginScreen } from "./features/auth/LoginScreen";
import { ConfirmProvider } from "./ui/ConfirmDialog";
import { ToastProvider, ToastStage } from "./ui/Toast";
import { OnlineStatusBadge } from "./shell/OnlineStatusBadge";
import { initFCM, setupForegroundHandler } from "./lib/fcm";

// Theme priority: URL ?theme=  →  localStorage  →  default light
function useTheme() {
  const [params] = useSearchParams();
  const urlTheme = params.get("theme");
  const dark =
    urlTheme === "dark" ||
    (urlTheme == null && readStoredTheme() === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
  }, [dark]);
  return dark;
}

function readStoredTheme(): "dark" | "light" | null {
  try {
    const v = localStorage.getItem("vibe-pipeline:theme");
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function BoardRoute() {
  useTheme();
  const [params] = useSearchParams();
  const density = (params.get("density") as "compact" | "medium") || "medium";
  const startCreating = params.get("creating") === "1";
  return <BoardScreen density={density} startCreating={startCreating} />;
}

function useFcmBootstrap() {
  useEffect(() => {
    void initFCM();
    const off = setupForegroundHandler(async (payload) => {
      const title =
        payload.notification?.title || payload.data?.title || "Vibe Pipeline";
      const body = payload.notification?.body || payload.data?.body || "";
      // Android Chrome 不認 new Notification() constructor,要走 ServiceWorkerRegistration.showNotification
      try {
        const reg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
        if (reg && Notification.permission === "granted") {
          await reg.showNotification(title, {
            body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            data: payload.data ?? {},
          });
          return;
        }
      } catch {}
      // desktop / non-mobile fallback
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(title, { body });
        }
      } catch {}
    });
    return off;
  }, []);
}

export default function App() {
  useFcmBootstrap();
  return (
    <BrowserRouter>
      <ConfirmProvider>
        <ToastProvider>
          <OnlineStatusBadge />
          <Routes>
            <Route path="/" element={<Navigate to="/board" replace />} />
            <Route path="/board" element={<BoardRoute />} />
            <Route path="/setup" element={<SetupScreen />} />
            <Route path="/login" element={<LoginScreen />} />
          </Routes>
          <ToastStage />
        </ToastProvider>
      </ConfirmProvider>
    </BrowserRouter>
  );
}

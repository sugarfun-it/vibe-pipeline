import { useEffect } from "react";
import { BoardScreen } from "./features/pipeline/board/BoardScreen";
import { ConfirmProvider } from "./ui/ConfirmDialog";
import { ToastProvider, ToastStage } from "./ui/Toast";
import { OnlineStatusBadge } from "./shell/OnlineStatusBadge";
import { ProjectPickerProvider } from "./contexts/ProjectPickerContext";
import { initFCM, setupForegroundHandler } from "./lib/fcm";
import { useUrlParam } from "./hooks/useUrlParam";
import { useLocalStorageState } from "./hooks/useLocalStorageState";

// Theme priority: URL ?theme=  →  localStorage  →  default light
// 第一個 frame 的 theme class 由 index.html inline script 設(避 flash),這裡只負責
// URL override 變動時同步 <html> class
function useTheme() {
  const [urlTheme] = useUrlParam("theme");
  const [stored] = useLocalStorageState<string | null>("vibe-pipeline:theme", null);
  const dark =
    urlTheme === "dark" || (urlTheme == null && stored === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
  }, [dark]);
  return dark;
}

function BoardRoute() {
  useTheme();
  const [densityRaw] = useUrlParam("density");
  const [creatingRaw] = useUrlParam("creating");
  const density = (densityRaw as "compact" | "medium") || "medium";
  const startCreating = creatingRaw === "1";
  return <BoardScreen density={density} startCreating={startCreating} />;
}

// 過去從 `/` redirect 到 `/board`(react-router Navigate),拔 router 後改用 effect 一次
// replaceState(冪等:已在 /board 就 no-op)。bookmark 兼容,不污染 history。
function useRootRedirect() {
  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", "/board" + window.location.search + window.location.hash);
    }
  }, []);
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
  useRootRedirect();
  return (
    <ConfirmProvider>
      <ToastProvider>
        <ProjectPickerProvider>
          <OnlineStatusBadge />
          <BoardRoute />
          <ToastStage />
        </ProjectPickerProvider>
      </ToastProvider>
    </ConfirmProvider>
  );
}

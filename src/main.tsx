import { createRoot } from "react-dom/client";
import App from "./App";
import { registerSW } from "./lib/swUpdate";

import "./styles/tokens.css";
import "./styles/board.css";
import "./styles/notif.css";
import "./styles/swUpdate.css";

// vite dev mode serve raw SW source(含 ES module import)→ classic SW context 撞 SyntaxError(雷 #19)。
// 只在 production build(bun run preview)註冊 SW,dev mode skip。
if (import.meta.env.PROD) {
  registerSW();
}

createRoot(document.getElementById("root")!).render(<App />);

// main.tsx 有執行到 = bundle 載成功 = 沒踩 stale-shell。清掉 index.html 自救旗標,
// 讓下次更新若再撞 stale SW 還能自動自救一次(防 loop 的 sessionStorage flag reset)。
try {
  sessionStorage.removeItem("vp-sw-recovered");
} catch {
  /* private mode / 不支援 → 無妨 */
}

// Entry point。順序很重要:
// 1. serve.ts  — Bun.serve 起來 + 寫 server.json + listen 訊息
// 2. boot.ts   — auth migration / FCM init / stale recovery / watchdog
//
// `server` re-export 保留給 routes/system.ts 的 update handler 用(graceful shutdown)。

import "./serve";
import "./boot";

export { server } from "./serve";

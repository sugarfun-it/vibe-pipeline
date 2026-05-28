// 一次性 boot 副作用:auth.json migration / FCM init / stale recovery / watchdog start。
// 從 server/index.ts split。import 本檔即觸發。

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { vibeHome } from "./lib/io/paths";
import * as projectStore from "./lib/domain/project";
import * as orchestrator from "./lib/runner/orchestrator";
import * as syncJob from "./lib/runner/syncJob";
import { initFCM } from "./lib/remote/fcm";

// 2026-05-24 auth removal migration:啟動時若舊 ~/.vibe-pipeline/auth.json 仍在 → 直接刪。
// 該檔在 auth feature 拔除後變孤兒,留著是垃圾(maintainer 確認 VP 無 user,no backup OK)。
// noop 一旦檔不存在,所以不影響後續 boot。
try {
  const orphan = join(vibeHome(), ".vibe-pipeline", "auth.json");
  if (existsSync(orphan)) {
    unlinkSync(orphan);
    console.log(`[migrate] removed orphan ${orphan}(auth feature 已於 2026-05-24 拔除)`);
  }
} catch (e) {
  console.warn(`[migrate] auth.json cleanup 失敗(不致命):${e instanceof Error ? e.message : String(e)}`);
}

void initFCM();

// Crash recovery: 啟動時掃所有有 .vibe-pipeline/ 的 recent project,
// 若 pipeline.state="running" 但 process 不在 (server 重啟),標 paused
(async () => {
  try {
    const recents = await projectStore.listRecent();
    for (const p of recents) {
      if (!p.hasInit) continue;
      try {
        await orchestrator.recoverStale(p.path);
        await syncJob.recoverStaleSync(p.path);
      } catch (e) {
        console.error(`[recover] ${p.path} failed:`, e);
      }
    }
  } catch (e) {
    console.error("[recover] scan failed:", e);
  }
})();

// Liveness watchdog:server 跑期間每 60s 掃 running map,抓 process 死了但
// exit handler 沒收到通知的 stale entry(Windows 偶發 socket / handle leak 場景)。
// recoverStale 只在啟動跑一次,watchdog 補 runtime 期間的偵測。
orchestrator.startWatchdog();

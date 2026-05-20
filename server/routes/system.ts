import { ok, err } from "./_http";
import { getVersionStatus } from "../lib/systemVersion";
import { preflightCheck, performUpdate, spawnNewBackend } from "../lib/updater";
import * as notifs from "../lib/notifs/store";
import * as projectStore from "../lib/projectStore";

export async function version(): Promise<Response> {
  try {
    const status = await getVersionStatus();
    return ok(status);
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
}

// POST /api/system/update
// tarball 模式:
//   preflight → emit notif → 下載 + 解壓到 ~/.vibe-pipeline/app/ → spawn 新 backend → 200 → ~500ms 後 self-exit
// preflight 失敗(pipeline running / 已最新版)回 400 + reason,不下載。
// download / extract 失敗回 500;app/ 可能半套,user 重跑 install script 即修(spec 決議,純前進)。
export async function update(): Promise<Response> {
  try {
    const pre = await preflightCheck();
    if (!pre.ok) {
      return err("invalid_path", pre.reason, 400);
    }

    // emit notif 到所有已知 project(system_updating 是全域事件,但 notifs store 是 per-project)
    // 任一 project 失敗安靜忽略,不阻擋 update
    try {
      const list = await projectStore.listRecent();
      for (const p of list) {
        try {
          notifs.emit(p.path, {
            type: "system_updating",
            title: "系統更新中",
            sub: "backend 即將重啟,稍後重整頁面",
            sev: "info",
          });
        } catch {
          // ignore single project failure
        }
      }
    } catch {
      // ignore
    }

    const result = await performUpdate();
    spawnNewBackend(result.appPath);

    // 排程 ~500ms 後自殺,讓 client 拿到 response 再斷
    setTimeout(() => {
      process.exit(0);
    }, 500);

    return ok({ started: true, newVersion: result.tag });
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
}

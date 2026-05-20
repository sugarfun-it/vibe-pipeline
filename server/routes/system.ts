import { ok, err } from "./_http";
import { getVersionStatus } from "../lib/systemVersion";
import { preflightCheck, downloadAndStage, writeHelperScript, spawnHelperDetached } from "../lib/updater";
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
// tarball + launcher pattern(避 Windows 自殺 cwd EBUSY):
//   preflight → emit notif → downloadAndStage(下載 + 解壓到 staging,不動 app/)
//   → writeHelperScript(寫 .ps1 / .sh helper,內含 wait-backend-die → rmrf app → mv staging → spawn 新 backend)
//   → spawnHelperDetached → response 200 → setTimeout 1500ms self-exit
// helper 等到 backend cwd lock 釋放才動 app/,避免「backend 刪自己 cwd」EBUSY。
// preflight 失敗(pipeline running / 已最新版)回 400。stage 失敗回 500,app/ 沒被動,user 重 install 即修。
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

    const staged = await downloadAndStage();
    const helperPath = writeHelperScript({
      backendPid: process.pid,
      stagingRoot: staged.stagingRoot,
      cleanupPaths: staged.cleanupPaths,
    });
    spawnHelperDetached(helperPath);

    // 1500ms 讓 helper 起來開始 watch backend pid + 讓 client 拿 response
    // helper 內最多等 30s backend exit,夠時間 client 收完 + browser 收 notif
    setTimeout(() => {
      process.exit(0);
    }, 1500);

    return ok({ started: true, newVersion: staged.tag });
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
}

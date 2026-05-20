import { ok, err } from "./_http";
import { getVersionStatus } from "../lib/systemVersion";
import { preflightCheck, downloadAndStageVersion, writePending } from "../lib/updater";
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
// Versioned + swap-on-start pattern(Scoop-style,2026-05-21 v3):
//   preflight → emit notif → downloadAndStageVersion(解到 versions/v<tag>/ + bun install)
//   → writePending(tag) → backend setTimeout 500ms self-exit
// User 跑 `vbpl server start`:vbpl CLI 偵測 .pending → swapCurrentTo(tag) → clearPending → spawn 新 backend
// from current/(= versions/v<tag>/)。
//
// 為什麼不自動 spawn 新 backend:過去 v1/v2 在 backend process 內 spawn 新 backend / helper script
// 整路炸 Windows(detach 不靈 / PowerShell encoding / cwd EBUSY...)。改成 user-driven restart
// 對齊 CLAUDE.md 雷 #15「server lifecycle = user-driven first class」。代價:user 多按一次
// `vbpl server start`,frontend (UpdateTab) 顯示提示。
//
// preflight 失敗(pipeline running / 已最新版)回 400。stage 失敗回 500;current/ 從未被動,
// backend 仍跑著舊版,user 重試即可。
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
            title: "系統更新已下載",
            sub: "請跑 `vbpl server start` 套用更新",
            sev: "info",
          });
        } catch {
          // ignore single project failure
        }
      }
    } catch {
      // ignore
    }

    const staged = await downloadAndStageVersion();
    writePending(staged.tag);

    // 500ms 後 self-exit,給 client 拿 response。User 之後跑 `vbpl server start`,
    // vbpl CLI 偵測 .pending → swap → spawn from current/。
    setTimeout(() => {
      process.exit(0);
    }, 500);

    return ok({
      started: true,
      newVersion: staged.tag,
      action: "restart_required",
      message: `Update ${staged.tag} downloaded. Run 'vbpl server start' to apply.`,
    });
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
}

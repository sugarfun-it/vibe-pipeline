import { ok, err } from "./_http";
import { getVersionStatus } from "../lib/system/version";
import { preflightCheck, spawnInstallScript } from "../lib/system/update";
import { server } from "../index";

// force=1 → 跳過 release-info cache 強制重抓(「檢查更新」按鈕用)
export async function version(force = false): Promise<Response> {
  try {
    const status = await getVersionStatus({ force });
    return ok(status);
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
}

// POST /api/system/update
//
// 簡化版 install-script-only flow(v0.2.4,跟 v0.2.x .pending hook 不同):
//   preflight → spawn install.{ps1,sh} detached + -AutoStart → response 200
//   → backend setTimeout 500ms self-exit → install script 跑(stop → download
//   → swap → start 新 backend)→ PWA polls /api/health 直到新 backend up。
//
// 為什麼 PWA-triggered 不撞 v0.2.x stdio chain bug:
//   PWA HTTP request 跟 backend stdio 無關。backend stdio = server.log fds(獨立)。
//   spawn install with stdio: ["ignore", logFd, logFd] → install 跑時 stdio = file
//   fds → install 的 grandchildren(新 backend)繼承 = file fds,沒 chain 到 HTTP request。
//
// CLI(`vbpl update`)路徑無 -AutoStart,user 自己跑 `vbpl server start` 後續(避 bash 端 chain)。
export async function update(): Promise<Response> {
  try {
    const pre = await preflightCheck();
    if (!pre.ok) {
      return err("invalid_path", pre.reason, 400);
    }

    // Reorder critical:**先 server.stop 再 spawn install**。
    //
    // 原因:Windows 上 CreateProcess 預設讓 child 繼承 parent 所有 inheritable handles,
    // 包括 Bun.serve 的 listening socket。若先 spawn install 再 stop server,install 後代
    // (powershell / vbpl server start / 新 backend)繼承 listening socket handle,即使
    // backend process.exit + server.stop,OS 看到還有 process 持 handle → port 卡 zombie
    // → 新 backend 起來撞 EADDRINUSE。
    //
    // 改先 server.stop(關 listening socket 釋放 handle),再 spawn install(這時 backend
    // open handle set 已無 listening socket,child 繼承不到 → port 乾淨釋放)。
    //
    // setTimeout 500ms 給 client 拿 response;先 await 拿到 response 再進延遲。
    setTimeout(async () => {
      try {
        await server.stop(true);
      } catch {
        // ignore
      }
      try {
        await spawnInstallScript();
      } catch {
        // install fail 也照樣 exit;next vbpl server start 仍可起來
      }
      process.exit(0);
    }, 500);

    return ok({
      started: true,
      message: "Update started. Backend will restart automatically; PWA reconnects in ~30s.",
    });
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
}

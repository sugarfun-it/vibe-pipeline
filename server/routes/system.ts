import { ok, err } from "./_http";
import { getVersionStatus } from "../lib/systemVersion";

// /api/system/version 只負責顯版本(current / GitHub latest / hasUpdate)。
// /api/system/update 已拔(2026-05-21 改 v3 versioned-swap 又重新評估,改 install-script-only):
//   update 邏輯全交給 scripts/install.{ps1,sh} 跟新加的 `vbpl update` subcommand,
//   後端只負責回報「現在版本」+「有沒有新版」給 UI 顯示。UI 顯示更新指令給 user copy/paste,
//   或 user 直接跑 `vbpl update`。整個 update flow 不再 cross 後端 process boundary。
//   詳見 docs/release/v0.3.0.md。
export async function version(): Promise<Response> {
  try {
    const status = await getVersionStatus();
    return ok(status);
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
}

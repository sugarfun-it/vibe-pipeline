// PWA 是否跑在 host PC 本地?用來決定要不要顯示「開啟資料夾 / worktree」這類
// 透過 backend 觸發 host PC 端 GUI 動作的功能 — 遠端(Tailscale / LAN IP)點下去 Explorer
// 在 host 開,遠端 user 看不到,等於壞功能。
export function isLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  // e2e / iter-uiux 模擬「user 從遠端(Tailscale)連」的旗號 — 真實環境用不到,
  // 純測試逃生口(`?vp_force_remote=1`)。瀏覽器無法 patch window.location.hostname,
  // 用 query flag 是最低成本的測試 hook,不對生產判斷有任何影響。
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("vp_force_remote") === "1") return false;
  } catch {}
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

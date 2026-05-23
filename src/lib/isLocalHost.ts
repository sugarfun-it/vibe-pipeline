// PWA 是否跑在 host PC 本地?用來決定要不要顯示「開啟資料夾 / worktree」這類
// 透過 backend 觸發 host PC 端 GUI 動作的功能 — 遠端(Tailscale / LAN IP)點下去 Explorer
// 在 host 開,遠端 user 看不到,等於壞功能。
export function isLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

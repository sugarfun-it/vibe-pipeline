// Date / number / size formatting helpers. 收斂原本散在各 component 的 fmtX 函式。
// 命名一律 formatX(避開原有 fmtX 名字以利轉場期 grep 區分)。
// Pipeline-domain helpers(fmtElapsed / fmtDuration)留在 src/data/pipelines.ts。

const pad = (n: number): string => String(n).padStart(2, "0");

export type DateTimeVariant =
  | "full"       // YYYY-MM-DD HH:MM:SS — 完整 audit / run log
  | "short"      // MM-DD HH:MM — TicketDrawer iter rows
  | "compact"    // M/D HH:MM — PipelineHistoryDrawer top summary
  | "full-tz";   // YYYY-MM-DD HH:MM (UTC±HH:MM) — title attribute 給 tooltip

export function formatDateTime(ms: number, variant: DateTimeVariant = "full"): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const mi = d.getMinutes();
  const s = d.getSeconds();
  if (variant === "compact") {
    return `${mo}/${day} ${pad(h)}:${pad(mi)}`;
  }
  if (variant === "short") {
    return `${pad(mo)}-${pad(day)} ${pad(h)}:${pad(mi)}`;
  }
  if (variant === "full-tz") {
    const tz = -d.getTimezoneOffset();
    const tzSign = tz >= 0 ? "+" : "-";
    const tzAbs = Math.abs(tz);
    return `${y}-${pad(mo)}-${pad(day)} ${pad(h)}:${pad(mi)} (UTC${tzSign}${pad(Math.floor(tzAbs / 60))}:${pad(tzAbs % 60)})`;
  }
  // full
  return `${y}-${pad(mo)}-${pad(day)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
}

// "N 時間前"。null / 0 / undefined → null(讓 caller 可以 `if (ago) {...}` 略過渲染)。
export function formatAgo(
  ms: number | null | undefined,
  lang: "zh" | "en" = "zh",
): string | null {
  if (!ms) return null;
  const since = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (lang === "en") {
    if (since < 60) return "just now";
    if (since < 3600) return `${Math.floor(since / 60)} min`;
    if (since < 86400) return `${Math.floor(since / 3600)} h`;
    return `${Math.floor(since / 86400)} d`;
  }
  if (since < 60) return "剛剛";
  if (since < 3600) return `${Math.floor(since / 60)}分鐘前`;
  if (since < 86400) return `${Math.floor(since / 3600)}小時前`;
  return `${Math.floor(since / 86400)}天前`;
}

// UpdateTab "上次檢查" 專用 — ≥ 1h 時改顯 HH:MM(當天時間)而非「N 小時前」,
// 因為 user 已經知道在今天看,絕對時間比 "3小時前" 直觀。
export function formatLastChecked(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 1234 → "1.2k" / 1_234_567 → "1.23M"
export function formatNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

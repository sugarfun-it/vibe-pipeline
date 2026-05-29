// Theme 解析共用語意:URL ?theme= override → localStorage → 預設 light(非 dark)。
// urlTheme === "dark" → dark;urlTheme === "light" → light;其餘(含 null / 未知值)看 stored。
// 兩個 callsite(App.tsx useTheme、TopBar 的 isDark)共用同一份,避免兩套不等價邏輯漂走。
export function resolveTheme(urlTheme: string | null | undefined, stored: string | null | undefined): boolean {
  if (urlTheme === "dark") return true;
  if (urlTheme === "light") return false;
  return stored === "dark";
}

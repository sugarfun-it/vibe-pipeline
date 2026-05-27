// 把後端 / mock 的 error.message 拆成「user-facing 主訊息 + 技術細節」。
// 規則:第一個全形 / 半形左括號開始到對應右括號為「技術細節」;前面是主訊息。
// 主訊息結尾加句號(如沒有);沒括號則整段為主訊息、無技術細節。
// 例:"無法讀取 git diff(模擬:工作樹被外部修改)" →
//      userMsg: "無法讀取 git diff。" techDetail: "(模擬:工作樹被外部修改)"
export function parseErrorMessage(raw: string): { userMsg: string; techDetail: string } {
  const trimmed = raw.trim();
  // match 第一個 ( 或 ( 開頭的 paren block(greedy 到最後一個對應的右括號)
  const m = /^([^()（）]*?)\s*([（(][\s\S]*[）)])\s*$/.exec(trimmed);
  if (!m) {
    return { userMsg: ensureSentenceEnd(trimmed), techDetail: "" };
  }
  return { userMsg: ensureSentenceEnd(m[1]), techDetail: m[2] };
}
function ensureSentenceEnd(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return /[。.!?！？]$/.test(t) ? t : t + "。";
}
// 已知 backend 訊息 → 真使用者語言 mapping。命中先用 mapping,沒命中保持原 user-facing 文字。
// 不直接寫死所有可能字串 — 只 normalize 已遇過的明顯技術字串(例 "無法讀取 git diff" / "git diff failed")。
export function humanizeUserMsg(raw: string): string {
  const t = raw.trim();
  if (!t) return "讀取差異時發生未知錯誤。";
  if (/^無法讀取\s*git\s*diff/i.test(t)) return "工作樹狀態異動,目前無法產生差異。";
  if (/git\s*diff\s*failed/i.test(t)) return "工作樹狀態異動,目前無法產生差異。";
  if (/timeout|逾時/i.test(t)) return "讀取差異逾時,請稍後再試。";
  if (/not\s*found|找不到/i.test(t)) return "找不到對應的 pipeline 工作樹。";
  return t;
}
export function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "-");
}

function filePathBase(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function filePathDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}

// 把 path 拆成 dir / base / ext,讓 CSS 三段獨立 shrink。
// 對 dotfile (e.g. .env / .eslintrc) 不切 ext — 沒有 ext 概念,整段當 base。
export function splitPath(p: string): { dir: string; base: string; ext: string } {
  const dir = filePathDir(p);
  const full = filePathBase(p);
  const dotIdx = full.lastIndexOf(".");
  // 沒 dot 或 dot 在開頭(dotfile)→ 整段算 base
  if (dotIdx <= 0) return { dir, base: full, ext: "" };
  return { dir, base: full.slice(0, dotIdx), ext: full.slice(dotIdx) };
}

// CSS.escape polyfill — id 含特殊字元(基本不會,但 slug 後 id 仍要 safe escape 給 querySelector)
export function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

export function markerFor(kind: DiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "del") return "−";
  if (kind === "hunk") return "@";
  if (kind === "meta") return " ";
  return " ";
}

// gutter 已顯示 +/-,把原文首字符的 +/- 去掉避免「+ +」雙標記;
// hunk / meta 行保留原樣(@@ / diff --git 等是 git 本來的標頭格式)
export function stripLeadSign(kind: DiffLine["kind"], text: string): string {
  if (kind === "add" || kind === "del") {
    return text.length > 0 && (text[0] === "+" || text[0] === "-") ? text.slice(1) : text;
  }
  return text;
}

export function srLabelFor(kind: DiffLine["kind"]): string {
  if (kind === "add") return "新增行 ";
  if (kind === "del") return "刪除行 ";
  if (kind === "hunk") return "區塊標頭 ";
  return "";
}

// 把 git diff 整段切成檔案 block,每行標 kind 給 CSS 上色。
export type DiffLine = { kind: "add" | "del" | "meta" | "hunk" | "context"; text: string };
export type DiffBlock = { path: string; lines: DiffLine[] };

export function parseDiffByFile(raw: string): DiffBlock[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const blocks: DiffBlock[] = [];
  let cur: DiffBlock | null = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      // "diff --git a/src/foo.ts b/src/foo.ts" → 取 b/ 後面當 path
      const m = /diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const path = m ? m[2] : line.slice("diff --git ".length);
      cur = { path, lines: [{ kind: "meta", text: line + "\n" }] };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    let kind: DiffLine["kind"] = "context";
    if (line.startsWith("@@")) kind = "hunk";
    else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity ") || line.startsWith("rename ")) kind = "meta";
    else if (line.startsWith("+")) kind = "add";
    else if (line.startsWith("-")) kind = "del";
    cur.lines.push({ kind, text: line + "\n" });
  }
  return blocks;
}

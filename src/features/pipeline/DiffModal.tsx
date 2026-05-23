import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as api from "../../api/projects";
import { useCopiedFeedback } from "../../hooks/useCopiedFeedback";
import { ArrowRightIcon, CloseIcon } from "../../ui/icons";
import { Overlay } from "../../ui/Overlay";
import { useToast } from "../../ui/Toast";
import "../../styles/drawer.css";
import "./diffModal.css";

export function DiffModal({
  projectHash,
  pipelineId,
  pipelineBranch,
  baseBranch,
  onClose,
}: {
  projectHash: string;
  pipelineId: string;
  pipelineBranch: string;
  baseBranch: string;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<api.FullDiff | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const { toast } = useToast();
  // 目前定位中的檔案 path(點 file row 時設定),畫上 active 視覺指示;
  // 不用 hash 路由 — modal 內導覽不該動瀏覽器 URL / history(雷:Esc / 上一頁語意被綁架)。
  const [activeFile, setActiveFile] = useState<string | null>(null);
  // fetch reload token — 「重新讀取」按鈕 +1 觸發 effect 重跑
  const [reloadToken, setReloadToken] = useState(0);
  // 「複製 diff」短暫回饋
  const { copied, flash: flashCopied } = useCopiedFeedback();
  const titleId = useId();
  const branchId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setLoadFailed(false);
    api
      .getFullDiff(projectHash, pipelineId)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadFailed(true);
        // 拆 user msg + tech detail,只把 user msg 經過 humanize 後丟 toast;tech detail 略過
        const parts = parseErrorMessage(e.message);
        toast(`讀取差異失敗:${humanizeUserMsg(parts.userMsg)}`, { variant: "danger" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectHash, pipelineId, reloadToken, toast]);

  // 點檔案列 → modal 內捲動到對應 block;不動 URL hash(避免污染 history / back button)。
  function jumpToFile(path: string) {
    setActiveFile(path);
    const id = "diff-file-" + slug(path);
    const target = contentRef.current?.querySelector<HTMLElement>("#" + cssEscape(id));
    const scroller = contentRef.current;
    if (target && scroller) {
      // 用相對 offset 而非 scrollIntoView,避免 modal 周圍 page 被連帶捲動
      const offset = target.offsetTop - scroller.offsetTop;
      scroller.scrollTo({ top: offset, behavior: "smooth" });
    }
  }

  // 載入後尚未點任何 file,顯示第一個檔案為 active(scroll position 預設在頂端,跟 UI 一致)。
  useEffect(() => {
    if (!activeFile && diff && diff.files.length > 0) {
      setActiveFile(diff.files[0].path);
    }
  }, [diff, activeFile]);

  // 手動捲動時 → IntersectionObserver 找最靠近 scroller 頂端的 file block,
  // 更新 activeFile,讓 file list 同步反白(沒這層,user 捲到中段不知道現在看哪份)。
  useEffect(() => {
    if (!diff || diff.files.length === 0) return;
    const scroller = contentRef.current;
    if (!scroller) return;
    const blocks = Array.from(
      scroller.querySelectorAll<HTMLElement>(".diff-modal-file-block")
    );
    if (blocks.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const topId = visible[0].target.id; // diff-file-<slug>
        const match = diff.files.find((f) => "diff-file-" + slug(f.path) === topId);
        if (match) setActiveFile((cur) => (cur === match.path ? cur : match.path));
      },
      // 0px top, -75% bottom → 只 fire 當 block 進入頂端 25%(避免大範圍同時 intersect 抖動)
      { root: scroller, rootMargin: "0px 0px -75% 0px", threshold: 0 }
    );
    blocks.forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [diff]);

  const totals = useMemo(() => {
    if (!diff) return { added: 0, deleted: 0 };
    let added = 0;
    let deleted = 0;
    for (const f of diff.files) {
      added += f.added;
      deleted += f.deleted;
    }
    return { added, deleted };
  }, [diff]);
  const addedTotal = totals.added;
  const deletedTotal = totals.deleted;

  // Overlay portal=true(預設):跳出 ReadyBanner 的 transform containing block(.fade-up 會困住 position:fixed)
  // initialFocus="close":優先 focus close button(stable selector);loading 時 close 仍是第一個可互動元素。
  return (
    <Overlay
      onRequestClose={onClose}
      labelledBy={titleId}
      describedBy={branchId}
      initialFocus="close"
      stageClassName="drawer-stage--modal diff-modal-stage"
      scrimClassName="diff-modal-scrim"
      surfaceClassName="drawer--modal diff-modal fade-up"
      surfaceRef={dialogRef}
    >
        <div className="drawer-head diff-modal-head">
          <div className="diff-modal-title">
            <span id={titleId}>差異</span>
            <span id={branchId} className="diff-modal-branch mono" title={`${pipelineBranch} → ${baseBranch}`}>
              {pipelineBranch} <span aria-hidden><ArrowRightIcon /></span> {baseBranch}
            </span>
          </div>
          {diff && (
            <span
              className="diff-modal-summary mono"
              aria-label={`共 ${diff.files.length} 個檔案,新增 ${addedTotal} 行,刪除 ${deletedTotal} 行`}
            >
              <span>{diff.files.length} 個檔案</span>
              <span aria-hidden className="diff-modal-summary-sep">·</span>
              <span className="diff-modal-stat-added">+{addedTotal}</span>
              <span className="diff-modal-stat-deleted">−{deletedTotal}</span>
            </span>
          )}
          <div className="diff-modal-actions">
            {diff && diff.files.length > 0 && (
              <button
                type="button"
                className="diff-modal-copy"
                onClick={() => {
                  // 直接複製 server 回傳的原始 git diff,維持完整可貼回 patch 工具
                  if (!diff?.raw) return;
                  const text = diff.raw;
                  const fallback = () => {
                    try {
                      const ta = document.createElement("textarea");
                      ta.value = text;
                      ta.style.position = "fixed";
                      ta.style.left = "-9999px";
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand("copy");
                      document.body.removeChild(ta);
                      flashCopied();
                    } catch {}
                  };
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text).then(() => flashCopied()).catch(fallback);
                  } else {
                    fallback();
                  }
                }}
                title="複製原始 diff"
                aria-label={copied ? "已複製 diff" : "複製原始 diff 到剪貼簿"}
              >
                {copied ? "已複製" : "複製 diff"}
              </button>
            )}
            <button
              type="button"
              className="drawer-close diff-modal-x"
              onClick={onClose}
              title="關閉 (Esc)"
              aria-label="關閉差異視窗 (Esc)"
            >
              <CloseIcon aria-hidden />
            </button>
          </div>
        </div>

        {loadFailed && !diff && (
          <div className="diff-modal-err" role="alert">
            <div className="diff-modal-err-title">讀取差異失敗</div>
            <button
              type="button"
              className="diff-modal-retry"
              onClick={() => setReloadToken((n) => n + 1)}
              aria-label="重新讀取差異"
            >
              重新讀取
            </button>
          </div>
        )}
        {!loadFailed && !diff && (
          <div className="diff-modal-loading" role="status" aria-live="polite">
            <span className="diff-modal-loading-dot" aria-hidden />
            載入中…
          </div>
        )}
        {diff && diff.files.length === 0 && (
          <div className="diff-modal-empty">沒有改動。</div>
        )}
        {diff && diff.files.length > 0 && (
          <div className="diff-modal-body">
            <nav className="diff-modal-files" aria-label="檔案清單">
              {diff.files.map((f) => {
                const isActive = activeFile === f.path;
                const parts = splitPath(f.path);
                return (
                  <button
                    key={f.path}
                    type="button"
                    className={"diff-modal-file-row mono" + (isActive ? " is-active" : "")}
                    onClick={() => jumpToFile(f.path)}
                    title={f.path}
                    aria-label={`跳到 ${f.path},新增 ${f.added} 行,刪除 ${f.deleted} 行`}
                    aria-current={isActive ? "location" : undefined}
                  >
                    {/* 兩行排版:
                        - 第一行:basename + ext (basename ellipsis,ext 永不縮)
                        - 第二行:dir (muted,ellipsis)
                        視覺 span 已被 button.aria-label 涵蓋,標 aria-hidden 避免 SR 讀兩次 */}
                    <span className="diff-modal-file-text" aria-hidden>
                      <span className="diff-modal-file-line1">
                        <span className="diff-modal-file-base">{parts.base}</span>
                        {parts.ext && <span className="diff-modal-file-ext">{parts.ext}</span>}
                      </span>
                      {parts.dir && (
                        <span className="diff-modal-file-dir">{parts.dir.replace(/\/$/, "")}</span>
                      )}
                    </span>
                    <span className="diff-modal-file-stat" aria-hidden>
                      <span className="diff-modal-stat-added">+{f.added}</span>
                      <span className="diff-modal-stat-deleted">−{f.deleted}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
            <div className="diff-modal-content mono" ref={contentRef}>
              {parseDiffByFile(diff.raw).map((block) => (
                <div
                  key={block.path}
                  id={`diff-file-${slug(block.path)}`}
                  className="diff-modal-file-block"
                >
                  <div className="diff-modal-file-header">{block.path}</div>
                  <pre className="diff-modal-pre">
                    {block.lines.map((l, i) => (
                      // append-only diff lines,內容會重複(空行 / context),index 是 stable 正確 key
                      // biome-ignore lint/suspicious/noArrayIndexKey: append-only diff lines
                      <span key={i} className={"diff-line is-" + l.kind}>
                        {/* SR-only label:add/del/hunk 行為 SR 朗讀 "新增" / "刪除" / "區塊";
                            否則 stripLeadSign 把 +/- 拿掉後,SR 只聽到 code,失去 add/del 訊號 */}
                        {(l.kind === "add" || l.kind === "del" || l.kind === "hunk") && (
                          <span className="sr-only">{srLabelFor(l.kind)}</span>
                        )}
                        <span className="diff-line-marker" aria-hidden>{markerFor(l.kind)}</span>
                        <span className="diff-line-text">{stripLeadSign(l.kind, l.text)}</span>
                      </span>
                    ))}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
    </Overlay>
  );
}

// 把後端 / mock 的 error.message 拆成「user-facing 主訊息 + 技術細節」。
// 規則:第一個全形 / 半形左括號開始到對應右括號為「技術細節」;前面是主訊息。
// 主訊息結尾加句號(如沒有);沒括號則整段為主訊息、無技術細節。
// 例:"無法讀取 git diff(模擬:工作樹被外部修改)" →
//      userMsg: "無法讀取 git diff。" techDetail: "(模擬:工作樹被外部修改)"
function parseErrorMessage(raw: string): { userMsg: string; techDetail: string } {
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
function humanizeUserMsg(raw: string): string {
  const t = raw.trim();
  if (!t) return "讀取差異時發生未知錯誤。";
  if (/^無法讀取\s*git\s*diff/i.test(t)) return "工作樹狀態異動,目前無法產生差異。";
  if (/git\s*diff\s*failed/i.test(t)) return "工作樹狀態異動,目前無法產生差異。";
  if (/timeout|逾時/i.test(t)) return "讀取差異逾時,請稍後再試。";
  if (/not\s*found|找不到/i.test(t)) return "找不到對應的 pipeline 工作樹。";
  return t;
}
function slug(s: string): string {
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
function splitPath(p: string): { dir: string; base: string; ext: string } {
  const dir = filePathDir(p);
  const full = filePathBase(p);
  const dotIdx = full.lastIndexOf(".");
  // 沒 dot 或 dot 在開頭(dotfile)→ 整段算 base
  if (dotIdx <= 0) return { dir, base: full, ext: "" };
  return { dir, base: full.slice(0, dotIdx), ext: full.slice(dotIdx) };
}

// CSS.escape polyfill — id 含特殊字元(基本不會,但 slug 後 id 仍要 safe escape 給 querySelector)
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function markerFor(kind: DiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "del") return "−";
  if (kind === "hunk") return "@";
  if (kind === "meta") return " ";
  return " ";
}

// gutter 已顯示 +/-,把原文首字符的 +/- 去掉避免「+ +」雙標記;
// hunk / meta 行保留原樣(@@ / diff --git 等是 git 本來的標頭格式)
function stripLeadSign(kind: DiffLine["kind"], text: string): string {
  if (kind === "add" || kind === "del") {
    return text.length > 0 && (text[0] === "+" || text[0] === "-") ? text.slice(1) : text;
  }
  return text;
}

function srLabelFor(kind: DiffLine["kind"]): string {
  if (kind === "add") return "新增行 ";
  if (kind === "del") return "刪除行 ";
  if (kind === "hunk") return "區塊標頭 ";
  return "";
}

// 把 git diff 整段切成檔案 block,每行標 kind 給 CSS 上色。
type DiffLine = { kind: "add" | "del" | "meta" | "hunk" | "context"; text: string };
type DiffBlock = { path: string; lines: DiffLine[] };

function parseDiffByFile(raw: string): DiffBlock[] {
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

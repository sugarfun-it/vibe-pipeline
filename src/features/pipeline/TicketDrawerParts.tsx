import { useState } from "react";
import ReactMarkdown from "react-markdown";

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tdrw-section">
      <div className="tdrw-section-label tdrw-section-title mono">{label}</div>
      <div className="tdrw-section-body">{children}</div>
    </div>
  );
}

export function ReadOnlyValue({ value }: { value: string | undefined }) {
  if (!value) return <span className="tdrw-empty">(空)</span>;
  return (
    <div className="tdrw-text tdrw-prompt-md">
      <ReactMarkdown>{value}</ReactMarkdown>
    </div>
  );
}

// 長 prompt 內容預設折疊,避免推走後續操作型 section(迭代輪次 / commit / 日誌 / 原因 / 狀態歷史)。
// 短內容(< 400 字)直接全顯,不放折疊鈕(不浪費 click)。
// 重點:永遠把完整 markdown 餵給 ReactMarkdown,不切原文(切 raw markdown 會切壞 fenced code block / list / table);
// 折疊用 CSS max-height + 漸層遮罩做視覺裁切。
// a11y:折疊時把所有可 focus 子元素 tabindex=-1,避免 Tab 跑到看不見的連結。
// 注意:不對整塊 aria-hidden — collapsed preview 仍是可見內容,設 aria-hidden 會讓 SR 連可見部分都讀不到。
// SR 可讀完整 markdown(內容仍在 DOM),視覺端用 max-height + fade 裁切;Tab 鏈不會跑到視覺外。
export function CollapsiblePrompt({ text, defaultCollapsed = false }: { text: string; defaultCollapsed?: boolean }) {
  const LONG = 400;
  const isLong = text.length > LONG;
  // done 狀態下短 prompt 也預設折疊(td-006:done 時 outcome 在前,原始 spec 退到後面收合)
  const shouldCollapse = isLong || defaultCollapsed;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const collapsed = shouldCollapse && !expanded;
  // TDRW-PROMPT-006:改用 inert(被裁切的 overflow 整塊讓 SR + 鍵盤都跳過),
  // 不再手動 patch tabindex。SR 改靠 .tdrw-prompt-sr-hint 提示「折疊中,可展開查看完整 N 字」。
  // (舊作法 tabindex=-1 只擋鍵盤,SR 仍會讀全文,造成「看不到但聽到」的不一致)
  return (
    <div className="tdrw-prompt-collapse">
      {shouldCollapse && collapsed && (
        <span className="sr-only">
          提示詞目前為視覺折疊預覽,共 {text.length} 字,可按下「展開全部」查看完整內容。
        </span>
      )}
      <div
        // @ts-expect-error inert is a valid HTML attribute supported by React 19; TS lib may lag
        inert={collapsed ? "" : undefined}
        className={"tdrw-prompt-md" + (collapsed ? " is-collapsed" : "")}
      >
        <ReactMarkdown>{text}</ReactMarkdown>
        {collapsed && <div className="tdrw-prompt-fade" aria-hidden />}
      </div>
      {shouldCollapse && (
        <button
          type="button"
          className="tdrw-prompt-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `收合提示詞,共 ${text.length} 字`
              : `展開提示詞,共 ${text.length} 字(目前折疊預覽)`
          }
        >
          {expanded ? "收合" : `展開全部 · 共 ${text.length} 字`}
        </button>
      )}
    </div>
  );
}

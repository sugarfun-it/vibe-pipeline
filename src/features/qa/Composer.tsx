import { useRef, useState } from "react";

export function Composer({
  options,
  optionsMode = "single",
  busy,
  onSend,
  onCancel,
  onTextChange,
  inputRef,
}: {
  options: string[];
  optionsMode?: "single" | "multi";
  busy: boolean;
  onSend: (msg: string) => void;
  onCancel: () => void;
  onTextChange?: (text: string) => void;
  inputRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const setTaRef = (el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    if (inputRef) inputRef.current = el;
  };
  const taId = "qadr-composer-textarea";

  function send(value: string) {
    const v = value.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
    onTextChange?.("");
    // 送出後重置 textarea 高度(setText 後 onChange 不會 fire,要手動)
    if (taRef.current) taRef.current.style.height = "auto";
  }

  // multi 模式 options 已由 InlineMultiSelect 在 body 內 inline 渲染,不再走 Composer。
  // Composer 只負責 single quickreply chips + textarea + send + cancel-link。
  return (
    <div className="qadr-composer">
      {options.length > 0 && optionsMode === "single" && (
        <div className="qadr-options">
          {options.map((o) => (
            <button type="button"
              key={o}
              className="btn qadr-option"
              onClick={() => send(o)}
              disabled={busy}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="qadr-composer-row">
        <label
          htmlFor={taId}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          描述要建立的需求單內容
        </label>
        <textarea
          ref={setTaRef}
          id={taId}
          className="qadr-input qadr-input-multiline"
          value={text}
          placeholder={busy ? "助理回覆後即可繼續補充…" : "描述要建立的需求單內容…"}
          rows={1}
          aria-label="描述要建立的需求單內容"
          aria-describedby={busy ? "qadr-thinking-status" : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onTextChange?.(e.target.value);
            // auto-grow:resize 到內容高度,max 8 行(超過 scroll)
            const ta = e.target;
            ta.style.height = "auto";
            const max = parseFloat(getComputedStyle(ta).lineHeight) * 8;
            ta.style.height = Math.min(ta.scrollHeight, max) + "px";
          }}
          onKeyDown={(e) => {
            // Enter 送出,Shift+Enter 換行
            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              send(text);
            }
          }}
          disabled={busy}
        />
        <button type="button"
          className="qadr-send"
          onClick={() => send(text)}
          disabled={busy || !text.trim()}
          aria-disabled={busy || !text.trim() ? "true" : undefined}
          title={!text.trim() ? "輸入內容後可送出（Enter）" : "送出（Enter）"}
          aria-label="送出訊息"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="qadr-composer-footer">
        <button
          className="qadr-cancel-link"
          onClick={onCancel}
          disabled={busy}
          type="button"
          title="放棄當前草稿，本次對話不會保留"
        >
          捨棄草稿
        </button>
        <div className="qadr-composer-hint mono" aria-hidden="true">
          Enter 送出 · Shift+Enter 換行
        </div>
      </div>
    </div>
  );
}

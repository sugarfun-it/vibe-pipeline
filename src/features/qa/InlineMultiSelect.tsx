import { useEffect, useRef, useState } from "react";
import { CheckIconSm } from "../../ui/icons";

export function InlineMultiSelect({
  options,
  busy,
  onSendMulti,
}: {
  options: string[];
  busy: boolean;
  onSendMulti: (picks: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const sendBtnRef = useRef<HTMLButtonElement | null>(null);
  const statusId = "qadr-inline-multi-status";
  // 新 AI turn 出新 options → 重置上輪選擇,避免殘留勾選誤送
  // biome-ignore lint/correctness/useExhaustiveDependencies: options is intentional reset trigger
  useEffect(() => {
    setPicked(new Set());
  }, [options]);
  // mobile:options 出現後 / user 改變勾選時,把送出按鈕滾進可視區,避免被 sticky footer 蓋住看不到主動作
  // biome-ignore lint/correctness/useExhaustiveDependencies: picked.size 是觸發訊號
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      sendBtnRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    });
    return () => cancelAnimationFrame(id);
  }, [picked.size]);

  function toggle(i: number) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function send() {
    if (busy || picked.size === 0) return;
    const chosen = Array.from(picked)
      .sort((a, b) => a - b)
      .map((i) => options[i]);
    onSendMulti(chosen);
    setPicked(new Set());
  }

  return (
    <div
      className="qadr-inline-multi"
      role="group"
      aria-label="多選回覆"
      aria-describedby={statusId}
    >
      <div
        className="qadr-options qadr-options-multi"
        role="group"
        aria-label="多選回覆選項"
      >
        {options.map((o, i) => {
          const checked = picked.has(i);
          // role=checkbox on a native <button> 已具備 Enter/Space activation;
          // 再加 onKeyDown handler 會 double-toggle。只留 onClick 即可。
          return (
            <button
              key={`${i}-${o}`}
              type="button"
              role="checkbox"
              aria-checked={checked}
              className={
                "btn qadr-option qadr-option-multi" + (checked ? " is-picked" : "")
              }
              onClick={() => toggle(i)}
              disabled={busy}
            >
              <span className="qadr-option-check" aria-hidden>
                {checked ? <CheckIconSm /> : null}
              </span>
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      <div
        id={statusId}
        role="status"
        aria-live="polite"
        className="qadr-multi-status"
      >
        {picked.size === 0 ? "尚未選擇任何選項" : `已選 ${picked.size} 項`}
      </div>
      <button
        ref={sendBtnRef}
        className="btn btn-primary qadr-multi-send"
        onClick={send}
        disabled={busy || picked.size === 0}
        type="button"
      >
        送出已選（{picked.size}）
      </button>
    </div>
  );
}

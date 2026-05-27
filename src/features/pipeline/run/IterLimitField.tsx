import { useEffect, useState } from "react";
import type { Ticket } from "../../../../shared/types";
import { NumberField } from "../../../ui/forms/NumberField";

// 迭代上限欄位:draft / ready 狀態的 iter ticket 顯 number input,點 ▲▼ / 直接打字改;
// 失焦或 Enter 才送(避免每按一下都打 API)。其他狀態 read-only 顯「上限 N 輪」。
export function IterLimitField({
  ticket,
  value,
  onChange,
}: {
  ticket: Ticket;
  value: number;
  onChange?: (ticketId: string, limit: number) => Promise<void> | void;
}) {
  const editable =
    !!onChange &&
    ticket.mode === "iter" &&
    (ticket.status === "draft" || ticket.status === "ready");
  const [draft, setDraft] = useState(String(value));
  // ticket value 從外部變化(別人改 / refetch)→ 同步進來
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  if (!editable) {
    return <span>上限 {value} 輪</span>;
  }
  const draftNum = Number(draft);
  const invalid =
    draft === "" || !Number.isFinite(draftNum) || draftNum < 1 || draftNum > 5 || !Number.isInteger(draftNum);
  // TD-ITER-INVALID-001:invalid 不再 blur 後靜默還原 — 留在畫面上等使用者改;只有 valid 才 commit。
  // user 想還原走 Esc(明確操作),不是 click 別處 → 值悄悄變回 5(data-loss surprise)。
  function commit() {
    if (invalid) return; // 不還原、不送 API,保留無效畫面等使用者處理
    if (draftNum !== value) onChange?.(ticket.id, draftNum);
  }
  return (
    <span className={"tdrw-iter-limit-wrap" + (invalid ? " is-invalid" : "")}>
      <span className="tdrw-iter-limit-label">上限</span>
      <NumberField
        label="迭代上限輪數"
        labelHidden
        ariaLabel="迭代上限輪數(1 至 5)"
        title="迭代上限輪數，範圍 1 至 5。按 Enter 送出，按 Esc 還原"
        min={1}
        max={5}
        value={draft === "" ? "" : Number(draft)}
        onChange={(v) => setDraft(v === "" ? "" : String(v))}
        onBlur={commit}
        onKeyDown={(e) => {
          // ESC 在 input 內只還原,不冒泡(免 TicketDrawer 全域 ESC 又收掉 drawer)
          if (e.key === "Enter") {
            e.stopPropagation();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        // TD-ITER-INVALID-004:標點全形 + 拆兩句,把 Esc 提示獨立(不擠在驗證訊息裡)
        error={invalid ? "請輸入 1 至 5 的整數。按 Esc 還原" : undefined}
        inline
        fieldClassName="tdrw-iter-limit-field"
        inputClassName={"tdrw-iter-limit" + (invalid ? " is-invalid" : "")}
      />
      <span className="tdrw-iter-limit-unit">輪（1 至 5）</span>
    </span>
  );
}

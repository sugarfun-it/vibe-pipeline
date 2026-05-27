import { useId, type ReactNode } from "react";

// SettingsField — Project tab field-row primitive。
// 把「label col + controls col(右側)+ saving 狀態 + hint/error 區塊」這個重複 pattern 收成一個元件。
// 不動 .settings-* CSS,只收斂 markup duplication。
//
// Layout(desktop):
//   ┌ label col (120px) ┬ controls col (1fr,含 saving status)┐
//   │  hint / error (subhint,padding-left 對齊 controls col)  │
//
// Mobile:label / controls / hint 上下 stack(由 .settings-field-row mobile media query 處理)。
//
// label 形態二選一:
//   - htmlFor:給的話 render <label htmlFor>,讓 click label 把 focus 推到 control(input / picker trigger)
//   - 否則 render <span id="<label-id>">,適合 control 不接受 htmlFor 的情境(toggle-pill 包 input、custom control)
//
// hint vs error:error 有值就顯 error(role="alert"),否則顯 hint。hint 可塞 ReactNode 支援 desktop / mobile 雙文案。

export type SettingsFieldProps = {
  /** label 文字(必要) */
  label: ReactNode;
  /** 對應 control id;有給就 render `<label htmlFor>`,否則 render `<span id>` */
  htmlFor?: string;
  /** label DOM id(讓外部 aria-labelledby 接得到);沒給會 auto-gen */
  labelId?: string;
  /** controls slot — 右欄內容(input / picker / toggle / 多個並排) */
  children: ReactNode;
  /** 預設 hint;error 為 truthy 時被 error 取代 */
  hint?: ReactNode;
  /** error 訊息(優先 hint);通常是 backend validation reason */
  error?: ReactNode;
  /** 正在儲存中 → 顯 inline 「儲存中…」chip */
  saving?: boolean;
  /** tight 版(toggle row 用):collapse row gap,toggle 不撐滿右欄 */
  tight?: boolean;
};

export function SettingsField({
  label,
  htmlFor,
  labelId,
  children,
  hint,
  error,
  saving,
  tight,
}: SettingsFieldProps) {
  const reactId = useId();
  const resolvedLabelId = labelId ?? `settings-field-${reactId.replace(/[^a-z0-9]/gi, "")}`;
  const showError = error !== undefined && error !== null && error !== "";
  const showHint = !showError && hint !== undefined && hint !== null && hint !== "";

  return (
    <>
      <div className={"settings-field-row" + (tight ? " settings-field-row--tight" : "")}>
        {htmlFor ? (
          <label className="settings-field-label" htmlFor={htmlFor} id={resolvedLabelId}>
            {label}
          </label>
        ) : (
          <span className="settings-field-label" id={resolvedLabelId}>
            {label}
          </span>
        )}
        <div className="settings-field-controls">
          {children}
          {saving && (
            <span className="settings-field-status" aria-live="polite">儲存中…</span>
          )}
        </div>
      </div>
      {showError ? (
        <div className="settings-subhint settings-subhint--error" role="alert">
          {error}
        </div>
      ) : showHint ? (
        <div className="settings-subhint">{hint}</div>
      ) : null}
    </>
  );
}

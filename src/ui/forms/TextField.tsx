import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import "./forms.css";

export type TextFieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password" | "tel" | "url" | "search";
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  placeholder?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  id?: string;
  name?: string;
  className?: string;
  inputClassName?: string;
  fieldClassName?: string;
  labelHidden?: boolean;
  spellCheck?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  // inline:wrapper 不撐父容器(width:auto + flex:0 0 auto),配合 inputClassName 設固定寬。
  // 用於跟其他控件並排在 row 內的場合(settings / iter-limit)— 取代過去 consumer 各自蓋 width 的 hack。
  inline?: boolean;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    value,
    onChange,
    type = "text",
    required,
    disabled,
    autoFocus,
    autoComplete,
    placeholder,
    inputMode,
    pattern,
    minLength,
    maxLength,
    id: idProp,
    name,
    className,
    inputClassName,
    fieldClassName,
    labelHidden,
    spellCheck,
    ariaLabel,
    ariaDescribedBy,
    inline,
  },
  ref,
) {
  const reactId = useId();
  const id = idProp || `vp-field-${reactId.replace(/[^a-z0-9]/gi, "")}`;
  const ownDescribedId = error || hint ? `${id}-desc` : undefined;
  const describedId =
    [ownDescribedId, ariaDescribedBy].filter(Boolean).join(" ") || undefined;
  const describedText = error ?? hint;

  return (
    <div
      className={
        "form-field" +
        (inline ? " form-field--inline" : "") +
        (fieldClassName ? ` ${fieldClassName}` : "")
      }
    >
      <label htmlFor={id} className={"form-label" + (labelHidden ? " form-label--sr" : "")}>
        <span>{label}</span>
        {required && (
          <span className="req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        ref={ref}
        id={id}
        name={name}
        type={type}
        className={"form-input" + (inputClassName ? ` ${inputClassName}` : "") + (className ? ` ${className}` : "")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedId}
        aria-disabled={disabled || undefined}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        inputMode={inputMode}
        pattern={pattern}
        minLength={minLength}
        maxLength={maxLength}
        spellCheck={spellCheck}
        aria-label={ariaLabel}
      />
      {describedText !== undefined && describedText !== null && describedText !== "" && (
        <div id={ownDescribedId} className={"form-hint" + (error ? " form-hint--error" : "")}>
          {describedText}
        </div>
      )}
    </div>
  );
});

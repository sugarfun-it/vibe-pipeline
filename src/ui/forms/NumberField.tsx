import { forwardRef, useId, type KeyboardEventHandler, type FocusEventHandler, type ReactNode } from "react";
import "./forms.css";

export type NumberFieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  value: number | "";
  onChange: (value: number | "") => void;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  name?: string;
  className?: string;
  inputClassName?: string;
  fieldClassName?: string;
  labelHidden?: boolean;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  title?: string;
  ariaLabel?: string;
};

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    label,
    hint,
    error,
    value,
    onChange,
    required,
    disabled,
    autoFocus,
    autoComplete,
    placeholder,
    min,
    max,
    step,
    id: idProp,
    name,
    className,
    inputClassName,
    fieldClassName,
    labelHidden,
    onBlur,
    onKeyDown,
    title,
    ariaLabel,
  },
  ref,
) {
  const reactId = useId();
  const id = idProp || `vp-field-${reactId.replace(/[^a-z0-9]/gi, "")}`;
  const describedId = error || hint ? `${id}-desc` : undefined;
  const describedText = error ?? hint;

  return (
    <div className={"form-field" + (fieldClassName ? ` ${fieldClassName}` : "")}>
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
        type="number"
        inputMode="numeric"
        className={"form-input" + (inputClassName ? ` ${inputClassName}` : "") + (className ? ` ${className}` : "")}
        value={value === "" ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange("");
            return;
          }
          const n = Number(raw);
          if (Number.isNaN(n)) return;
          onChange(n);
        }}
        required={required}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedId}
        aria-disabled={disabled || undefined}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        title={title}
        aria-label={ariaLabel}
      />
      {describedText !== undefined && describedText !== null && describedText !== "" && (
        <div id={describedId} className={"form-hint" + (error ? " form-hint--error" : "")}>
          {describedText}
        </div>
      )}
    </div>
  );
});

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
      />
      {describedText !== undefined && describedText !== null && describedText !== "" && (
        <div id={describedId} className={"form-hint" + (error ? " form-hint--error" : "")}>
          {describedText}
        </div>
      )}
    </div>
  );
});

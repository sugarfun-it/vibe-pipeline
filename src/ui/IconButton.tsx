import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./iconButton.css";

export type IconButtonVariant = "default" | "ghost" | "primary" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">;

export interface IconButtonProps extends NativeButtonProps {
  icon: ReactNode;
  ariaLabel: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  tooltip?: string;
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    ariaLabel,
    variant = "default",
    size = "md",
    tooltip,
    pressed,
    disabled,
    type,
    className,
    title,
    ...rest
  },
  ref,
) {
  const classes = [
    "vp-icon-button",
    "vp-icon-button--" + variant,
    "vp-icon-button--" + size,
    pressed ? "is-pressed" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      aria-label={ariaLabel}
      aria-pressed={typeof pressed === "boolean" ? pressed : undefined}
      title={tooltip ?? title}
      disabled={disabled}
      {...rest}
    >
      <span className="vp-icon-button__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
});

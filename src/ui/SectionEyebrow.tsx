import type { ReactNode } from "react";
import "./sectionEyebrow.css";

export type SectionEyebrowProps = {
  children: ReactNode;
  id?: string;
  htmlFor?: string;
  className?: string;
  "aria-hidden"?: boolean;
};

export function SectionEyebrow({
  children,
  id,
  htmlFor,
  className,
  "aria-hidden": ariaHidden,
}: SectionEyebrowProps) {
  const cls = "section-eyebrow" + (className ? ` ${className}` : "");
  if (htmlFor) {
    return (
      <label id={id} htmlFor={htmlFor} className={cls} aria-hidden={ariaHidden}>
        {children}
      </label>
    );
  }
  return (
    <div id={id} className={cls} aria-hidden={ariaHidden}>
      {children}
    </div>
  );
}

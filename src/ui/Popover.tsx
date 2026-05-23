import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export type PopoverPlacement =
  | "bottom-end"
  | "bottom-start"
  | "top-end"
  | "top-start";

export type PopoverProps = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  placement?: PopoverPlacement;
  offset?: number;
  restoreFocus?: boolean;
  role?: "menu" | "listbox" | "dialog" | "group";
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
  matchAnchorWidth?: boolean;
  // 預設 open 時自動 focus 第一個 menuitem / option(roving focus pattern)。
  // listbox 用 aria-activedescendant 的場合(focus 留在 listbox container,鍵盤事件由 caller 處理),設為 false。
  autoFocusFirstItem?: boolean;
  // 若 true,Popover 內部不接管 ArrowUp/Down/Home/End(留給 caller 自己的 listbox keydown handler)
  manageRovingFocus?: boolean;
  children: ReactNode;
};

type ResolvedPos = {
  top: number;
  left: number;
  transform: string;
  width?: number;
};

function computePosition(
  anchorRect: DOMRect,
  menuW: number,
  menuH: number,
  placement: PopoverPlacement,
  offset: number,
): ResolvedPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const wantsBottom = placement.startsWith("bottom");
  const wantsEnd = placement.endsWith("end");

  const below = vh - anchorRect.bottom - offset;
  const above = anchorRect.top - offset;
  const openUp = wantsBottom ? menuH > below && above > below : !(menuH > above && below > above);

  const top = openUp
    ? Math.max(8, anchorRect.top - menuH - offset)
    : anchorRect.bottom + offset;

  let left: number;
  let transform = "";
  if (wantsEnd) {
    left = anchorRect.right;
    transform = "translateX(-100%)";
    if (menuW > 0) {
      const projectedLeft = anchorRect.right - menuW;
      if (projectedLeft < 8) {
        left = 8;
        transform = "";
      } else if (anchorRect.right > vw - 8) {
        left = vw - 8;
        transform = "translateX(-100%)";
      }
    }
  } else {
    left = anchorRect.left;
    transform = "";
    if (menuW > 0 && left + menuW > vw - 8) {
      left = Math.max(8, vw - 8 - menuW);
    }
  }

  return { top, left, transform };
}

export function Popover({
  anchorRef,
  open,
  onClose,
  placement = "bottom-end",
  offset = 4,
  restoreFocus = true,
  role,
  ariaLabel,
  ariaLabelledBy,
  className,
  id,
  style,
  matchAnchorWidth = false,
  autoFocusFirstItem = true,
  manageRovingFocus = true,
  children,
}: PopoverProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<ResolvedPos | null>(null);
  const wasOpenRef = useRef(false);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const menu = menuRef.current;
    const mw = menu?.offsetWidth ?? 0;
    const mh = menu?.offsetHeight ?? 0;
    const next = computePosition(r, mw, mh, placement, offset);
    if (matchAnchorWidth) next.width = r.width;
    setPos(next);
  }, [anchorRef, placement, offset, matchAnchorWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
    const onResize = () => reposition();
    const onScroll = () => reposition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, anchorRef, onClose]);

  useEffect(() => {
    if (!open) return;
    function focusFirst() {
      const root = menuRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"]), [role="option"]:not([disabled]):not([aria-disabled="true"])',
      );
      first?.focus();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        if (restoreFocus) anchorRef.current?.focus?.();
        return;
      }
      if (!menuRef.current) return;
      const items = Array.from(
        menuRef.current.querySelectorAll<HTMLElement>(
          '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"]), [role="option"]:not([disabled]):not([aria-disabled="true"])',
        ),
      );
      if (items.length === 0) return;
      const cur = document.activeElement as HTMLElement | null;
      const inMenu = !!(cur && menuRef.current.contains(cur));
      const idx = inMenu ? items.indexOf(cur as HTMLElement) : -1;
      if (manageRovingFocus) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          items[(idx + 1 + items.length) % items.length]?.focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          items[(idx - 1 + items.length) % items.length]?.focus();
        } else if (e.key === "Home") {
          e.preventDefault();
          items[0]?.focus();
        } else if (e.key === "End") {
          e.preventDefault();
          items[items.length - 1]?.focus();
        } else if (e.key === "Tab") {
          onClose();
        }
      }
    }
    const t = autoFocusFirstItem ? window.setTimeout(focusFirst, 0) : 0;
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, restoreFocus, anchorRef, manageRovingFocus, autoFocusFirstItem]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      if (restoreFocus) anchorRef.current?.focus?.();
    }
  }, [open, restoreFocus, anchorRef]);

  if (!open) return null;

  const mergedStyle: CSSProperties = pos
    ? {
        position: "fixed",
        top: pos.top,
        left: pos.left,
        transform: pos.transform || undefined,
        width: pos.width,
        ...style,
      }
    : { position: "fixed", visibility: "hidden", ...style };

  return createPortal(
    <div
      ref={menuRef}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      id={id}
      className={className}
      style={mergedStyle}
    >
      {children}
    </div>,
    document.body,
  );
}

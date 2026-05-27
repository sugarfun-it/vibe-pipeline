import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// 共用 overlay primitive — 收斂 drawer / modal / popup 的樣板:
// 1. ESC keydown(input / textarea / contenteditable target 不關)
// 2. Tab / Shift+Tab focus trap wrap(撞邊界繞回另一端)
// 3. 開啟時把 stage 兄弟標 inert + aria-hidden(從 root 一路往上到 body,每一層把不含 root 的兄弟都標掉)
// 4. 關閉時把焦點還給打開前的 trigger(try-catch 包,trigger 可能在 overlay 開期間從 DOM 拔掉)
// 5. scrim 點擊 → onRequestClose(caller 決定是否真的 close,例:有未存草稿先彈確認)
// 6. portal(預設 true):render through createPortal to document.body;false → in-place(QADrawer 現行就 inline,scrim 蓋的是 board 區域)
// 7. body scroll lock(預設只在 portal=true 鎖):module-level ref-count,multi-overlay
//    (例 TicketDrawer 內按 split → ConfirmDialog)時內層 close 不會誤拔外層的 lock;
//    最後一個 close 才還原 body 樣式並把 scrollY 還回去。lockBodyScroll=false 可 opt-out
//    (in-place QADrawer scrim 只蓋 board 區,本來就不該鎖 body)。

// ── Module-level scroll lock ref-count ─────────────────────────────
// 多個 overlay 同時開時,只在「第一個 acquire」改 body,「最後一個 release」還原。
// 用 position:fixed + top:-scrollY 模式(非 overflow:hidden):
//   - iOS Safari overflow:hidden 對 body 不鎖 touch scroll;fixed 才鎖
//   - 還原時 window.scrollTo(0, savedScrollY) 回到原位
let scrollLockCount = 0;
let savedScrollY = 0;
let savedBodyPosition = "";
let savedBodyTop = "";
let savedBodyWidth = "";
let savedBodyOverflow = "";

function acquireScrollLock() {
  if (scrollLockCount === 0) {
    savedScrollY = window.scrollY;
    savedBodyPosition = document.body.style.position;
    savedBodyTop = document.body.style.top;
    savedBodyWidth = document.body.style.width;
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
}

function releaseScrollLock() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.position = savedBodyPosition;
    document.body.style.top = savedBodyTop;
    document.body.style.width = savedBodyWidth;
    document.body.style.overflow = savedBodyOverflow;
    window.scrollTo(0, savedScrollY);
  }
}

export type OverlayProps = {
  /** dialog | alertdialog */
  role?: "dialog" | "alertdialog";
  /** ESC / scrim click / close × 共用入口;caller 決定是否真的 close(例:有 pending state 先攔) */
  onRequestClose: () => void;
  /** aria-labelledby — 指向 head 內標題的 id */
  labelledBy?: string;
  /** aria-describedby */
  describedBy?: string;
  /** 是否 portal 到 document.body(預設 true);false 時 in-place 渲染 */
  portal?: boolean;
  /** 是否鎖 body scroll(預設跟隨 portal:portal=true → 鎖,portal=false → 不鎖)。
   * multi-overlay 場景由 module-level ref-count 保證最後一個 close 才還原。 */
  lockBodyScroll?: boolean;
  /** 是否在卸載時還焦點給打開前的 trigger(預設 true) */
  restoreFocus?: boolean;
  /** 初始 focus 的元素;預設 focus drawer root(tabindex=-1) */
  initialFocus?: "auto" | "first" | "close" | "root";
  /** scrim 額外 class */
  scrimClassName?: string;
  /** overlay 容器額外 class(套在 .drawer-stage 上) */
  stageClassName?: string;
  /** surface 額外 class(套在 .drawer 上) */
  surfaceClassName?: string;
  /** surface 內容 */
  children: ReactNode;
  /** 額外的 surface ref(caller 想抓 drawer 內 DOM 用) */
  surfaceRef?: React.MutableRefObject<HTMLDivElement | null>;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Overlay({
  role = "dialog",
  onRequestClose,
  labelledBy,
  describedBy,
  portal = true,
  lockBodyScroll,
  restoreFocus = true,
  initialFocus = "root",
  scrimClassName,
  stageClassName,
  surfaceClassName,
  children,
  surfaceRef,
}: OverlayProps) {
  const internalSurfaceRef = useRef<HTMLDivElement | null>(null);
  const setSurfaceRef = (el: HTMLDivElement | null) => {
    internalSurfaceRef.current = el;
    if (surfaceRef) surfaceRef.current = el;
  };

  // Body scroll lock(ref-counted)。default 跟 portal 同調:
  //   portal=true(全屏 modal/drawer)→ 鎖 body 避免背景捲動穿透
  //   portal=false(in-place,例 QADrawer 只蓋 board 區)→ 不鎖
  // multi-overlay(例 TicketDrawer 內開 ConfirmDialog)同時 acquire,內層 close 只 dec
  // count,最後一個 close 才還原 body 樣式 + 跳回 savedScrollY。
  const shouldLock = lockBodyScroll ?? portal;
  useEffect(() => {
    if (!shouldLock) return;
    acquireScrollLock();
    return () => {
      releaseScrollLock();
    };
  }, [shouldLock]);

  // 開時把 stage 兄弟標 inert + aria-hidden,卸載時還原。
  // 從 surface 往上走到 body,每一層把不含自己的兄弟元素都標掉(同時涵蓋 portal=true:root 直接掛 body 下,
  // 走一輪就結束)跟 portal=false:in-place 在 BoardScreen 子樹內,要一路標到 body)。
  // 開時自動 focus(initialFocus 決定要 focus root / first / close 按鈕);卸載時還焦點給原 trigger。
  useEffect(() => {
    const surface = internalSurfaceRef.current;
    if (!surface) return;
    // 先記原 trigger(打開前 active element)
    const opener = restoreFocus ? (document.activeElement as HTMLElement | null) : null;

    // stage(.drawer-stage)是 surface 的 parent。inert 從 stage 一路往上爬。
    const stage = surface.parentElement as HTMLElement | null;
    const affected: HTMLElement[] = [];
    if (stage) {
      let node: HTMLElement | null = stage;
      while (node && node.parentElement && node !== document.body) {
        const parent: HTMLElement = node.parentElement;
        const cur = node;
        Array.from(parent.children).forEach((sib) => {
          const el = sib as HTMLElement;
          if (el === cur) return;
          // 不重複標:caller 自己有 aria-hidden=true 已設過的(罕見)也記下,卸載時還原成「移掉屬性」
          affected.push(el);
          el.setAttribute("aria-hidden", "true");
          (el as unknown as { inert: boolean }).inert = true;
        });
        node = parent;
      }
    }

    // 初始 focus
    let focusTarget: HTMLElement | null = null;
    if (initialFocus === "root") focusTarget = surface;
    else if (initialFocus === "close") {
      focusTarget = surface.querySelector<HTMLElement>(".drawer-close, .create-x");
    } else if (initialFocus === "first" || initialFocus === "auto") {
      focusTarget = surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    }
    try {
      focusTarget?.focus();
    } catch {}

    return () => {
      affected.forEach((el) => {
        el.removeAttribute("aria-hidden");
        (el as unknown as { inert: boolean }).inert = false;
      });
      if (restoreFocus && opener && typeof opener.focus === "function") {
        // trigger 可能在 overlay 開期間從 DOM 拔掉(例:ticket 被刪、project 切換)
        try {
          opener.focus();
        } catch {}
      }
    };
    // 一次性 mount/unmount,deps 故意空
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once setup
  }, []);

  // keydown:ESC + Tab focus trap。onRequestClose / surface ref 不變,但 onRequestClose 引用會變,放 deps。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const root = internalSurfaceRef.current;
      if (!root) return;
      if (e.key === "Tab") {
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);
        if (focusables.length === 0) {
          // 沒可 focus 就把焦點壓回 root,避免逃到背景
          e.preventDefault();
          try {
            root.focus();
          } catch {}
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const outside = !active || !root.contains(active);
        const onRoot = active === root;
        if (e.shiftKey) {
          if (outside || onRoot || active === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (outside || active === last) {
            e.preventDefault();
            first.focus();
          } else if (onRoot) {
            e.preventDefault();
            first.focus();
          }
        }
        return;
      }
      if (e.key !== "Escape") return;
      // ESC 在 input / textarea / contenteditable 上交給元件自己處理(例:IterLimitField ESC 還原)
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      onRequestClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onRequestClose]);

  const node = (
    <div className={"drawer-stage" + (stageClassName ? " " + stageClassName : "")}>
      <div
        className={"drawer-scrim" + (scrimClassName ? " " + scrimClassName : "")}
        onClick={onRequestClose}
        aria-hidden="true"
      />
      <div
        ref={setSurfaceRef}
        className={"drawer" + (surfaceClassName ? " " + surfaceClassName : "")}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );

  if (portal) return createPortal(node, document.body);
  return node;
}

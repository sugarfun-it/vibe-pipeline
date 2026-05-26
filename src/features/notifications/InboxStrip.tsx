import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BellIcon } from "../../ui/icons";
import { SEV_COLOR } from "../../lib/notifications";
import type { NotifItem } from "../../types/notif";
import { SEV_TEXT } from "./inboxLabels";

export function InboxStrip({
  items,
  unreadCount,
  onExpand,
  onItemClick,
}: {
  items: NotifItem[];
  unreadCount: number;
  onExpand: () => void;
  onItemClick: (id: string, pipelineId?: string) => void;
}) {
  // pips 區是 hover/wheel/keyboard 的 preview surface。dots 視覺索引,不個別 button(太小)。
  // hover 進入 .inbox-strip-pips → 進 preview mode(顯第一則);滾輪改 idx;
  // keyboard:focus 進 pips → previewIdx=0;ArrowUp/Down 改 idx;Enter/Space 跳當前;ESC 清。
  // touch / non-hover click → 沒 preview 就 expand(避免意外跳轉);有 preview 才跳。
  const SHOW = 12;
  const visible = items.slice(0, SHOW);
  const overflow = Math.max(0, items.length - SHOW);
  const hasItems = visible.length > 0;

  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const pipsRef = useRef<HTMLButtonElement>(null);
  // popover 用 portal 跳出 .inbox-col 的 overflow:hidden,改 fixed 定位
  const [previewPos, setPreviewPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (previewIdx === null) {
      setPreviewPos(null);
      return;
    }
    const el = pipsRef.current;
    if (!el) return;
    // 抓被 preview 那顆 dot 的 rect,垂直對齊它;水平錨在 pips 區左外 8px
    const dot = el.querySelectorAll<HTMLElement>(".inbox-strip-pip")[previewIdx];
    const pipsRect = el.getBoundingClientRect();
    const dotRect = dot?.getBoundingClientRect();
    setPreviewPos({
      top: dotRect ? dotRect.top + dotRect.height / 2 : pipsRect.top + pipsRect.height / 2,
      right: window.innerWidth - pipsRect.left + 8,
    });
  }, [previewIdx]);

  // wheel 換 preview 項。preventDefault 不讓頁面跟著捲(passive: false)
  useEffect(() => {
    const el = pipsRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (visible.length === 0) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      setPreviewIdx((prev) => {
        const cur = prev ?? 0;
        const next = cur + dir;
        if (next < 0) return 0;
        if (next >= visible.length) return visible.length - 1;
        return next;
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [visible.length]);

  const previewItem = previewIdx !== null ? visible[previewIdx] : null;

  // 動態 aria-label:reflect 總數 / 未讀 / overflow / 當前 preview
  const pipsAriaLabel = (() => {
    if (!hasItems) return "通知列表(目前 0 則)";
    const parts: string[] = [];
    parts.push(`通知列表,${items.length} 則`);
    if (unreadCount > 0) parts.push(`${unreadCount} 未讀`);
    if (overflow > 0) parts.push(`顯示前 ${SHOW},另有 ${overflow} 則`);
    if (previewItem) {
      parts.push(
        `目前預覽 ${(previewIdx ?? 0) + 1}/${visible.length}:` +
          `${SEV_TEXT[previewItem.sev] ?? ""}通知「${previewItem.title}」` +
          (previewItem.unread ? ",未讀" : ""),
      );
    }
    return parts.join(",");
  })();

  // 是否為 coarse pointer(touch 主裝置)— 用來決定 click 行為(touch 直接 expand,不跳轉)
  const isCoarsePointer = (): boolean => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(pointer: coarse)").matches;
  };

  return (
    <div className="inbox-strip">
      <button
        type="button"
        className={"inbox-strip-bell" + (unreadCount > 0 ? " has-unread" : "")}
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        title={unreadCount > 0 ? `展開通知(${unreadCount} 未讀)` : "展開通知"}
        aria-label={unreadCount > 0 ? `展開通知,${unreadCount} 未讀` : "展開通知"}
        aria-expanded={false}
        aria-controls="inbox-aside"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="inbox-strip-bell-num mono" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      <div className="inbox-strip-divider"></div>

      {/* dots 區整塊當一個觸碰區:有 preview 就跳該則,沒有 preview / touch → expand;
          空 inbox 時整顆 pips 不 render(bell 才是 expand 控制) */}
      {hasItems ? (
        <button
          ref={pipsRef}
          type="button"
          className="inbox-strip-pips"
          onMouseEnter={() => {
            // 同 onFocus:touch 瀏覽器會合成 mouseenter(tap-related),也要 guard,
            // 否則第一 tap 仍會經「previewItem 存在 → 跳轉」分支。
            if (typeof window !== "undefined" && window.matchMedia &&
                window.matchMedia("(hover: none)").matches) return;
            setPreviewIdx(0);
          }}
          onMouseLeave={() => setPreviewIdx(null)}
          onFocus={() => {
            // touch / coarse-pointer 不在 focus 時設 preview:focus 經常是 tap 副作用,
            // 設了會讓緊隨的 click 落到「previewItem 存在」分支 → 變成 first-tap 直接跳轉。
            if (typeof window !== "undefined" && window.matchMedia &&
                window.matchMedia("(hover: none)").matches) return;
            if (visible.length > 0) setPreviewIdx(0);
          }}
          onBlur={() => setPreviewIdx(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPreviewIdx((p) => Math.min(visible.length - 1, (p ?? -1) + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setPreviewIdx((p) => Math.max(0, (p ?? visible.length) - 1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setPreviewIdx(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setPreviewIdx(visible.length - 1);
            } else if (e.key === "Escape") {
              setPreviewIdx(null);
              (e.currentTarget as HTMLElement).blur();
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const idx = previewIdx ?? 0;
              const it = visible[idx];
              if (it) onItemClick(it.id, it.pipelineId);
            }
          }}
          onClick={() => {
            // mouse 路徑:有 preview 就跳;沒 preview 跳第一則(滑鼠進入會自動設 0,所以多數情境會有)
            // touch / coarse pointer 路徑:沒 hover → 沒 preview → expand,避免誤跳轉
            if (previewItem) {
              onItemClick(previewItem.id, previewItem.pipelineId);
            } else if (isCoarsePointer()) {
              onExpand();
            } else if (visible.length > 0) {
              onItemClick(visible[0].id, visible[0].pipelineId);
            } else {
              onExpand();
            }
          }}
          title={
            previewItem
              ? "點擊跳該 pipeline · 滾輪 / 方向鍵切換"
              : "hover / focus 預覽 · 滾輪 / 方向鍵切換 · 點擊跳"
          }
          aria-label={pipsAriaLabel}
          aria-describedby={previewItem ? "inbox-strip-preview-live" : undefined}
        >
          {visible.map((it, i) => (
            <span
              key={it.id}
              className={
                "inbox-strip-pip" +
                (it.unread ? " is-unread" : "") +
                " is-" + it.sev +
                (i === previewIdx ? " is-preview" : "")
              }
              style={{ ["--strip-color" as string]: SEV_COLOR[it.sev] } as React.CSSProperties}
              aria-hidden="true"
            />
          ))}
          {overflow > 0 && (
            <span className="inbox-strip-overflow mono" aria-hidden="true">
              +{overflow}
            </span>
          )}
        </button>
      ) : (
        // empty strip:整塊中段當第二個 expand 觸發區(避免 52px 寬只有 bell 一顆能點)
        <button
          type="button"
          className="inbox-strip-pips-empty"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          title="展開通知"
          aria-label="展開通知"
        />
      )}

      <div className="inbox-strip-spacer"></div>
      <div className="inbox-strip-label" aria-hidden="true">通知</div>

      {previewItem && previewPos && createPortal(
        <div
          id="inbox-strip-preview-live"
          role="status"
          aria-live="polite"
          className="inbox-strip-preview"
          style={{
            ["--preview-color" as string]: SEV_COLOR[previewItem.sev],
            top: previewPos.top,
            right: previewPos.right,
          } as React.CSSProperties}
        >
          <div className="inbox-strip-preview-head">
            <span className={"inbox-strip-preview-dot is-" + previewItem.sev} />
            <span className="inbox-strip-preview-title">{previewItem.title}</span>
          </div>
          {previewItem.sub && (
            <div className="inbox-strip-preview-sub">{previewItem.sub}</div>
          )}
          <div className="inbox-strip-preview-meta mono">
            {previewItem.ts} · {previewIdx! + 1}/{visible.length}
            {previewItem.unread ? " · 未讀" : ""}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

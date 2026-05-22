import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "../../styles/drawer.css";
import "./ticketDrawer.css";
import { RunHistory } from "./RunHistory";
import { AuditTimeline } from "./AuditTimeline";

// Pipeline-level 執行紀錄 drawer。從 pipeline header OverflowMenu 開,
// 顯示該 pipeline 跑過的所有 runner spawn(cost / duration / result / token)。
// 跟 TicketDrawer 用同一套 .drawer-stage / .drawer 樣式;portal 到 body 避免 stacking context 雷
export function PipelineHistoryDrawer({
  pipelineName,
  pipelineBranch,
  pipelineId,
  projectHash,
  onClose,
}: {
  pipelineName: string;
  pipelineBranch: string;
  pipelineId: string;
  projectHash: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // 開 drawer 前 active element(通常是 overflow menu item,或 menu 收掉後焦點落回的 overflow trigger button)→ 關閉時還焦點回去。
  // 初始焦點放在 drawer 容器本身(tabindex=-1),讓 SR 朗讀 aria-labelledby 的 dialog 標題「執行紀錄」,而不是先唸「關閉」。Tab 一次才走到 close ×。
  // 同時 lock body scroll,避免 scrim 下 board 在 wheel/touch 時漂移(unlock 在 cleanup;保留原 overflow 值還回去)。
  useEffect(() => {
    const trigger = (document.activeElement as HTMLElement) || null;
    drawerRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (trigger && typeof trigger.focus === "function") {
        try { trigger.focus(); } catch {}
      }
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Tab — 輕量 focus trap:Tab / Shift+Tab 撞到 drawer 邊界時 wrap 回另一端,
      // 不讓焦點從 drawer 逃到底下 board / scrim。
      if (e.key === "Tab") {
        const root = drawerRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const outside = !active || !root.contains(active);
        // 初始 focus 停在 drawer 容器(tabindex=-1)時:Tab 走 first、Shift+Tab 走 last,
        // 避免 Shift+Tab 從容器逃到底下 board(active 是 root 時不是 first 也不是 last,原條件漏接)
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
      // ESC 在 input / textarea / contenteditable 上要讓元件自己處理(例:展開區內 textarea search),別關 drawer
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="drawer-stage tdrw-stage">
      {/* scrim 是純 pointer target,不是語義按鈕。aria-hidden 從 a11y tree 抽掉,
          keyboard 走 close × / Esc;onClick 仍維持點空白關閉的滑鼠 / 觸控操作 */}
      <div
        className="drawer-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="drawer tdrw-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={drawerRef}
        tabIndex={-1}
      >
        <div className="drawer-head">
          <div className="drawer-crumb">
            <span className="mono">{pipelineName}</span>
            <span className="drawer-crumb-spacer" />
            <button
              type="button"
              className="create-x"
              onClick={onClose}
              title="關閉執行紀錄 (Esc)"
              aria-label="關閉執行紀錄"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="drawer-titlerow">
            <div className="drawer-title" id={titleId}>執行紀錄</div>
          </div>
          <div className="drawer-meta mono">
            {pipelineBranch} · 此 Pipeline 的所有 Runner 執行紀錄
          </div>
        </div>
        <div className="drawer-body">
          {/* RunHistory(本體執行紀錄)在前,AuditTimeline(狀態變動歷史,可摺疊)在後,
              對齊 drawer 標題「執行紀錄」承諾;狀態變動歷史是輔助,放下面 */}
          <RunHistory projectHash={projectHash} pipelineId={pipelineId} />
          <AuditTimeline projectHash={projectHash} pipelineId={pipelineId} />
        </div>
      </div>
    </div>,
    document.body
  );
}

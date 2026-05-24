/* ============================================================================
   BoardRail V2 · components (icons / RailItem / CreateCard / ConfirmDialog)
   Exposed on window for the app file.
   ============================================================================ */

const { useState, useMemo, useEffect, useRef } = React;

/* ─── icons ─────────────────────────────────────────────────────────── */

const PlusIcon = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const CloseIcon = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
const DotsHorizontalIcon = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" {...p}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);
const TrashIcon = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const BranchIcon = (p) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);
const CheckIconSm = (p) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M4 12.5 9.5 18 20 6" />
  </svg>
);
const WarnIcon = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M12 9v5" />
    <circle cx="12" cy="17.5" r="0.8" fill="currentColor" />
  </svg>
);

/* ─── helpers ───────────────────────────────────────────────────────── */

const PIPELINE_STATE_TEXT = {
  planning: "規劃中",
  running: "執行中",
  paused: "暫停",
  ready: "可合併",
  merged: "已合併",
  failed: "失敗",
};

function lastActivityAt(p) {
  let max = 0;
  for (const t of p.tickets) {
    if (typeof t.endedAt === "number") max = Math.max(max, t.endedAt);
    if (typeof t.startedAt === "number") max = Math.max(max, t.startedAt);
  }
  return max > 0 ? max : null;
}
function fmtAgo(ms) {
  if (!ms) return null;
  const since = Math.floor((Date.now() - ms) / 1000);
  if (since < 60) return "剛剛";
  if (since < 3600) return `${Math.floor(since / 60)}分鐘前`;
  if (since < 86400) return `${Math.floor(since / 3600)}小時前`;
  return `${Math.floor(since / 86400)}天前`;
}
function railSecondary(p) {
  const base = p.baseBranch || "main";
  const branchSuffix = (p.branch || "").replace(/^pipeline\//, "");
  const ago = fmtAgo(lastActivityAt(p));
  const agoSuffix = ago ? ` · ${ago}` : "";
  if (p.state === "running") {
    const t = p.tickets.find((x) => x.status === "running");
    if (t) {
      const title = t.title.length > 18 ? t.title.slice(0, 17) + "…" : t.title;
      return `▶ #${t.n} ${title}${agoSuffix}`;
    }
    return `執行中${agoSuffix}`;
  }
  if (p.state === "merged") return `已併入 ${base}${agoSuffix}`;
  if (p.state === "ready") return `可合併入 ${base}${agoSuffix}`;
  if (p.state === "failed") return `失敗${agoSuffix}`;
  if (p.state === "paused") {
    const last = [...p.tickets].reverse().find((x) => x.status === "paused" || x.status === "running");
    if (last) return `⏸ #${last.n}${agoSuffix}`;
    return `暫停${agoSuffix}`;
  }
  const planningAgo = ago ? `更新於 ${ago}` : (p.createdAt ? `建立於 ${fmtAgo(p.createdAt) || "剛剛"}` : "");
  if (branchSuffix !== p.name) return planningAgo ? `⎇ ${branchSuffix} · ${planningAgo}` : `⎇ ${branchSuffix}`;
  return planningAgo ? `尚未執行 · ${planningAgo}` : "尚未執行";
}

function MiniCells({ tickets }) {
  return tickets.map((t) => {
    const fill =
      t.status === "done" ? "var(--done)"
      : t.status === "running" ? "var(--running)"
      : t.status === "paused" ? "var(--paused)"
      : t.status === "failed" || t.status === "failed_iter_limit" || t.status === "failed_transient" ? "var(--failed)"
      : t.status === "ready" ? "var(--running-soft)"
      : "var(--line-2)";
    return (
      <span
        key={t.id}
        className={"rail-mini-cell" + (t.status === "running" ? " is-running" : "")}
        style={{ background: fill }}
      />
    );
  });
}

/* ─── V2 RailItem ───────────────────────────────────────────────────── */

function RailItemV2({ p, active, onClick, muted, hasDraft }) {
  const done = p.tickets.filter((t) => t.status === "done").length;
  const total = p.tickets.length;
  const stateText = PIPELINE_STATE_TEXT[p.state] || p.state;
  return (
    <button
      type="button"
      className={"rail-item" + (active ? " is-active" : "") + (muted ? " is-muted" : "")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={`${p.name} · ${stateText} · ${done}/${total} ticket 完成` + (hasDraft ? " · QA 進行中" : "")}
      aria-disabled={muted ? true : undefined}
      tabIndex={muted ? -1 : undefined}
    >
      <div className="rail-item-row">
        <span
          className={"rail-status-chip" + (p.state === "running" ? " is-running" : "")}
          data-state={p.state}
          aria-hidden="true"
        >
          <span className="rail-status-chip-dot" />
          <span>{stateText}</span>
        </span>
        <span className="rail-item-name" title={p.name}>{p.name}</span>
        {hasDraft && <span className="mono rail-qa-badge" aria-hidden="true" title="進行中 QA">QA</span>}
        <span className="rail-item-count mono" aria-hidden="true" title={`${done} / ${total} ticket 已完成`}>
          {done}/{total}
        </span>
      </div>
      <div className="rail-mini" aria-hidden="true">
        <MiniCells tickets={p.tickets} />
      </div>
      <div className="rail-item-meta" aria-hidden="true">
        <span className="mono">{railSecondary(p)}</span>
      </div>
    </button>
  );
}

/* ─── RailSectionMenu (verbatim from prototype) ─────────────────────── */

function RailSectionMenu({ items }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      const t = e.target;
      if (menuRef.current && menuRef.current.contains(t)) return;
      if (triggerRef.current && triggerRef.current.contains(t)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div className={"rail-section-overflow" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="rail-section-overflow-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="更多操作"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DotsHorizontalIcon />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Rail section 操作"
          className="focus-overflow-menu rail-section-overflow-menu"
          style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, left: "auto" }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={"focus-overflow-item" + (it.danger ? " is-danger" : "")}
              disabled={!!it.disabledReason}
              title={it.disabledReason || undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (it.disabledReason) return;
                setOpen(false);
                it.onClick();
              }}
            >
              <span className="focus-overflow-item-icon">{it.icon || <TrashIcon />}</span>
              <span className="focus-overflow-item-label">{it.label}</span>
              {it.disabledReason && (
                <span className="mono focus-overflow-item-hint">{it.disabledReason}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, {
  PlusIcon, CloseIcon, DotsHorizontalIcon, TrashIcon, BranchIcon, CheckIconSm, WarnIcon,
  PIPELINE_STATE_TEXT, lastActivityAt, fmtAgo, railSecondary, MiniCells,
  RailItemV2, RailSectionMenu,
});

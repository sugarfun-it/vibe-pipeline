import { useEffect, useRef, useState } from "react";
import { PlusIcon, TrashIcon } from "../ui/icons";
import { STATE_COLOR } from "../data/pipelines";
import type { Pipeline } from "../types/pipeline";

// Rail section header 的 ⋯ menu item。array-driven 結構,未來 actions 直接 push 進去。
// disabled + tooltip 用 disabledReason 表達(非 undefined → disabled,值就是 tooltip)。
export type RailMenuItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabledReason?: string;
  onClick: () => void;
};

export function Rail({
  pipelines,
  activeId,
  onSelect,
  creating = false,
  onStartCreate,
  createSlot,
  addLabel = "新 pipeline",
  draftPipelineIds,
  sectionMenuItems,
}: {
  pipelines: Pipeline[];
  activeId: string;
  onSelect: (id: string) => void;
  creating?: boolean;
  onStartCreate?: () => void;
  createSlot?: React.ReactNode;
  addLabel?: string;
  draftPipelineIds?: Set<string>;
  sectionMenuItems?: RailMenuItem[];
}) {
  return (
    <aside className={"rail" + (creating ? " is-creating" : "")}>
      <div className="rail-section-header">
        <span className="rail-section-label mono">PIPELINES</span>
        {sectionMenuItems && sectionMenuItems.length > 0 && (
          <RailSectionMenu items={sectionMenuItems} />
        )}
      </div>
      <div className="rail-list">
        {creating ? (
          createSlot
        ) : (
          <button type="button" className="rail-add" onClick={onStartCreate}>
            <PlusIcon /> <span>{addLabel}</span>
          </button>
        )}

        {pipelines.map((p) => (
          <RailItem
            key={p.id}
            p={p}
            active={p.id === activeId}
            onClick={() => onSelect(p.id)}
            muted={creating}
            hasDraft={draftPipelineIds?.has(p.id) ?? false}
          />
        ))}
      </div>
      <div className="rail-spacer" />
      {/* Archive 功能未實作,prototype 留下的假 chip 移除避免誤導 */}
    </aside>
  );
}

function RailItem({
  p,
  active,
  onClick,
  muted,
  hasDraft,
}: {
  p: Pipeline;
  active: boolean;
  onClick: () => void;
  muted?: boolean;
  hasDraft?: boolean;
}) {
  const done = p.tickets.filter((t) => t.status === "done").length;
  const total = p.tickets.length;
  return (
    <button type="button" className={"rail-item" + (active ? " is-active" : "") + (muted ? " is-muted" : "")} onClick={onClick}>
      <div className="rail-item-row">
        <span className="rail-state-dot" style={{ background: STATE_COLOR[p.state] }} />
        <span className="rail-item-name">{p.name}</span>
        {hasDraft && (
          <span className="mono rail-qa-badge" title="進行中 QA">
            QA
          </span>
        )}
        <span className="rail-item-count mono">
          {done}/{total}
        </span>
      </div>
      <div className="rail-mini">
        {p.tickets.map((t) => {
          const fill =
            t.status === "done"
              ? "var(--done)"
              : t.status === "running"
              ? "var(--running)"
              : t.status === "paused"
              ? "var(--paused)"
              : t.status === "failed" ||
                t.status === "failed_iter_limit" ||
                t.status === "failed_transient"
              ? "var(--failed)"
              : t.status === "ready"
              ? "var(--running-soft)"
              : "var(--line-2)";
          return <span key={t.id} className={"rail-mini-cell" + (t.status === "running" ? " is-running" : "")} style={{ background: fill }} />;
        })}
      </div>
      <div className="rail-item-meta">
        <span className="mono">{railSecondary(p)}</span>
      </div>
    </button>
  );
}

// PIPELINES section header 的 ⋯ menu。click-outside / Esc 關閉、disabled+tooltip 支援。
function RailSectionMenu({ items }: { items: RailMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={wrapRef} className={"rail-section-overflow" + (open ? " is-open" : "")}>
      <button
        type="button"
        className="rail-section-overflow-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="focus-overflow-menu rail-section-overflow-menu">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={"focus-overflow-item" + (it.danger ? " is-danger" : "")}
              disabled={!!it.disabledReason}
              title={it.disabledReason ?? undefined}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onClick();
              }}
            >
              <span className="focus-overflow-item-icon">{it.icon ?? <TrashIcon />}</span>
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

// 第二行 state-aware:用明確中文表 merge 狀態,不用「→」避免被當「已合併」。
function railSecondary(p: Pipeline): string {
  const base = p.baseBranch || "main";
  const branchSuffix = p.branch.replace(/^pipeline\//, "");
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
    const last = [...p.tickets].reverse().find(
      (x) => x.status === "paused" || x.status === "running"
    );
    if (last) return `⏸ #${last.n}${agoSuffix}`;
    return `暫停${agoSuffix}`;
  }
  // planning(或未知 state):只顯時間,branch 跟 name 不同才補 branch
  if (branchSuffix !== p.name) return `⎇ ${branchSuffix}${agoSuffix}`;
  return ago ?? "未執行";
}

function lastActivityAt(p: Pipeline): number | null {
  let max = 0;
  for (const t of p.tickets) {
    if (typeof t.endedAt === "number") max = Math.max(max, t.endedAt);
    if (typeof t.startedAt === "number") max = Math.max(max, t.startedAt);
    if (t.iter?.rounds) {
      for (const r of t.iter.rounds) {
        if (typeof r.endedAt === "number") max = Math.max(max, r.endedAt);
        if (typeof r.startedAt === "number") max = Math.max(max, r.startedAt);
      }
    }
    if (t.commits) {
      for (const c of t.commits) {
        if (c && typeof c.ts === "number") max = Math.max(max, c.ts);
      }
    }
  }
  return max > 0 ? max : null;
}

function fmtAgo(ms: number | null): string | null {
  if (!ms) return null;
  const since = Math.floor((Date.now() - ms) / 1000);
  if (since < 60) return "剛剛";
  if (since < 3600) return `${Math.floor(since / 60)}分鐘前`;
  if (since < 86400) return `${Math.floor(since / 3600)}小時前`;
  return `${Math.floor(since / 86400)}天前`;
}

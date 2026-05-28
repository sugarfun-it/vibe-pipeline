import { useRef, useState } from "react";
import { DotsHorizontalIcon, PlusIcon, TrashIcon } from "../ui/icons";
import { Popover } from "../ui/Popover";
import type { Pipeline } from "../../shared/types";
import { RailItem } from "../features/pipeline/board/RailItem";

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

// 通用 slotted 容器:只負責版面(section header / add / empty hint / list 排版),
// 每一項的 ticket-status→色映射 / merge 文案 / 活動時間推導等 feature 邏輯都在
// features/pipeline/board/RailItem.tsx,shell 不碰。
export function Rail({
  pipelines,
  activeId,
  onSelect,
  creating = false,
  onStartCreate,
  createSlot,
  addLabel = "新增 pipeline",
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
  const isEmpty = !creating && pipelines.length === 0;
  return (
    <aside className={"rail" + (creating ? " is-creating" : "")} aria-label="Pipeline 列表">
      <div className="rail-section-header">
        <span className="rail-section-label mono" id="rail-pipelines-label">PIPELINES</span>
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

        {isEmpty && (
          <p className="rail-empty-hint" role="note">
            還沒有 pipeline。點上方<span className="mono">「+ {addLabel}」</span>建立第一條。
          </p>
        )}

        <div
          role="group"
          aria-labelledby="rail-pipelines-label"
          className="rail-list-items"
          style={{ display: "contents" }}
        >
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
      </div>
      <div className="rail-spacer" />
      {/* Archive 功能未實作,prototype 留下的假 chip 移除避免誤導 */}
    </aside>
  );
}

// PIPELINES section header 的 ⋯ menu。anchor 量測 / outside / esc / roving focus / flip 走 <Popover>。
function RailSectionMenu({ items }: { items: RailMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="rail-section-overflow">
      <button
        ref={triggerRef}
        type="button"
        className="btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="更多操作"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DotsHorizontalIcon />
      </button>
      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        offset={8}
        role="menu"
        ariaLabel="Rail section 操作"
        className="menu-surface focus-overflow-menu rail-section-overflow-menu"
      >
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
              if (it.disabledReason) return;
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
      </Popover>
    </div>
  );
}

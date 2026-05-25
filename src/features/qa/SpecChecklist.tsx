import { useId, useState } from "react";
import type { TicketSpec } from "../../api/qa";

export const FIELD_LABELS: { key: keyof TicketSpec; label: string }[] = [
  { key: "title", label: "標題" },
  { key: "goal", label: "目標" },
  { key: "acceptance", label: "驗收" },
  { key: "prompt", label: "提示詞" },
  { key: "mode", label: "模式" },
];

export function SpecChecklist({ spec }: { spec: Partial<TicketSpec> | null }) {
  const [expanded, setExpanded] = useState<keyof TicketSpec | null>(null);
  const filled = (key: keyof TicketSpec) => {
    if (!spec) return false;
    const v = spec[key];
    if (v == null || v === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (key === "mode") return v === "step" || v === "iter";
    return true;
  };
  const doneCount = FIELD_LABELS.filter((f) => filled(f.key)).length;
  const expandedField = expanded ? FIELD_LABELS.find((f) => f.key === expanded) : null;
  const expandedValue = expanded && spec ? spec[expanded] : undefined;

  function toggle(key: keyof TicketSpec) {
    setExpanded((cur) => (cur === key ? null : key));
  }

  const baseId = useId();
  const panelId = `${baseId}-chip-panel`;
  return (
    <div className="qadr-checklist">
      <div
        className="qadr-checklist-row"
        role="group"
        aria-label={`規格進度 ${doneCount} / ${FIELD_LABELS.length}`}
      >
        {FIELD_LABELS.map((f) => {
          const isFilled = filled(f.key);
          const isOpen = expanded === f.key;
          return (
            <button
              key={f.key}
              type="button"
              className={
                "qadr-chip" +
                (isFilled ? " is-filled" : "") +
                (isOpen ? " is-expanded" : "")
              }
              title={`${f.label}・${isFilled ? "已填" : "未填"}`}
              aria-label={`${f.label}（${isFilled ? "已填" : "未填"}）`}
              aria-expanded={isOpen}
              aria-controls={isOpen ? panelId : undefined}
              onClick={() => toggle(f.key)}
            >
              <span className="qadr-chip-dot" aria-hidden />
              <span className="qadr-chip-label">{f.label}</span>
            </button>
          );
        })}
        <span className="qadr-checklist-count mono" aria-hidden>
          {doneCount}/{FIELD_LABELS.length}
        </span>
      </div>
      {expandedField && (
        <div
          className="qadr-chip-panel"
          id={panelId}
          role="region"
          aria-label={`${expandedField.label}內容`}
        >
          <div className="qadr-chip-panel-label mono">{expandedField.label}</div>
          <div className="qadr-chip-panel-value">
            {!filled(expandedField.key) ? (
              <span className="qadr-chip-panel-empty">（未填）</span>
            ) : Array.isArray(expandedValue) ? (
              <ul className="qadr-chip-panel-list">
                {expandedValue.map((v) => (
                  <li key={String(v)}>{v}</li>
                ))}
              </ul>
            ) : (
              <span>{String(expandedValue)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

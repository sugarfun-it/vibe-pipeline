import type React from "react";
import { CloseIcon } from "../../ui/icons";
import { SEV_COLOR } from "../../lib/notifications";
import type { NotifItem } from "../../types/notif";
import { SEV_TEXT } from "./inboxLabels";

export function InboxItem({
  item,
  highlight,
  onMarkRead,
  onDismiss,
  onClick,
}: {
  item: NotifItem;
  highlight: boolean;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onClick: () => void;
}) {
  const c = SEV_COLOR[item.sev];
  const ariaLabel = (() => {
    const parts: string[] = [];
    parts.push(item.unread ? "未讀" : "已讀");
    parts.push(`${SEV_TEXT[item.sev] ?? ""}通知`);
    parts.push(`標題:「${item.title}」`);
    if (item.sub) parts.push(`說明:${item.sub}`);
    parts.push(`時間:${item.ts}`);
    return parts.join("。");
  })();
  // Structural fix: card 是 <article>(無 role),主開啟動作改成獨立的 .inbox-item-open <button>
  // 用 absolute inset:0 覆蓋整張卡作為 "click-anywhere" hit area;X / actions 是兄弟 <button>
  // 設 z-index:1 蓋過 open button(避免被攔截)。這樣徹底消除 nested interactive。
  return (
    <article
      className={"inbox-item is-" + item.sev + (item.unread ? " is-unread" : "") + (highlight ? " fade-up" : "")}
      style={{ ["--item-color" as string]: c } as React.CSSProperties}
    >
      <button
        type="button"
        className="inbox-item-open"
        onClick={onClick}
        aria-label={`開啟${ariaLabel}相關 pipeline`}
      />
      <button type="button"
        className="inbox-item-x"
        title="移除"
        aria-label={`移除通知「${item.title}」`}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(item.id);
        }}
      >
        <CloseIcon />
      </button>
      <div className="inbox-item-head">
        <span className={"inbox-item-dot" + (item.unread ? " is-unread" : " is-read")} aria-hidden="true" />
        <span className="inbox-item-title">{item.title}</span>
      </div>
      <div className="inbox-item-sub">{item.sub}</div>
      <div className="inbox-item-meta">
        <span className="inbox-item-ts mono">{item.ts}</span>
      </div>
      {(item.primary || item.secondary) && (
        <div className="inbox-item-actions">
          {item.secondary && (
            <button type="button"
              className="inbox-item-action"
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(item.id);
              }}
            >
              {item.secondary.label}
            </button>
          )}
          {item.primary && (
            <button type="button"
              className={
                "inbox-item-action" +
                (item.primary.kind === "block"
                  ? " is-primary"
                  : item.primary.kind === "info"
                  ? " is-primary-info"
                  : "")
              }
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
            >
              {item.primary.label}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

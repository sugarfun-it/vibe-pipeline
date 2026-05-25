import { ChevronRightIcon, InboxEmptyIcon } from "../../ui/icons";
import type { InboxFilter } from "../../types/notif";
import type { Common } from "./InboxColumn";
import { InboxItem } from "./InboxItem";

export function InboxPanel({
  items,
  filter,
  setFilter,
  unreadCount,
  highlightId,
  onCollapse,
  onMarkRead,
  onDismiss,
  onMarkAllRead,
  onDismissAll,
  onItemClick,
}: Common & { onCollapse: () => void }) {
  const filtered = items.filter((it) => {
    if (filter === "unread") return !!it.unread;
    if (filter === "blocking") return it.sev === "block";
    return true;
  });

  const blockCount = items.filter((i) => i.sev === "block").length;
  const highlightItem = highlightId ? items.find((i) => i.id === highlightId) : null;

  return (
    <div className="inbox-panel">
      <div className="inbox-head">
        <h3>通知</h3>
        {unreadCount > 0 && <span className="inbox-head-count mono">{unreadCount} 未讀</span>}
        <div className="inbox-head-actions">
          <button
            type="button"
            className="icon-btn inbox-collapse-btn"
            title="收合通知"
            onClick={onCollapse}
            aria-label="收合通知欄"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <fieldset className="inbox-filter" aria-label="通知篩選">
        {(
          [
            ["all", "全部", items.length],
            ["unread", "未讀", unreadCount],
            ["blocking", "阻斷", blockCount],
          ] as const
        ).map(([key, label, count]) => (
          <button type="button"
            key={key}
            className={"inbox-filter-btn" + (filter === key ? " is-active" : "")}
            onClick={() => setFilter(key as InboxFilter)}
            aria-pressed={filter === key}
            aria-label={`${label}通知 篩選,${count} 則${filter === key ? ",目前選取" : ""}`}
          >
            {label}
            <span className="inbox-filter-count mono" aria-hidden="true">{count}</span>
          </button>
        ))}
      </fieldset>

      {/* SR-only live region — highlightId 變動時公告「已開啟通知:「<title>」」 */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {highlightItem ? `已開啟通知：「${highlightItem.title}」` : ""}
      </div>

      {filtered.length === 0 ? (
        <div className="inbox-list inbox-list-empty" role="status" aria-live="polite">
          <div className="inbox-empty">
            <div className="inbox-empty-icon">
              <InboxEmptyIcon />
            </div>
            <div>
              {items.length === 0
                ? "目前沒有通知"
                : filter === "unread"
                  ? "都看過了"
                  : filter === "blocking"
                    ? "沒有阻斷類通知"
                    : "目前沒有通知"}
            </div>
          </div>
        </div>
      ) : (
        <ul
          className="inbox-list"
          aria-label={`通知列表,共 ${filtered.length} 則${
            filter === "all" ? "" : `(已套用「${filter === "unread" ? "未讀" : "阻斷"}」篩選)`
          }`}
        >
          {filtered.map((it) => (
            <li key={it.id} className="inbox-list-item">
              <InboxItem
                item={it}
                highlight={highlightId === it.id}
                onMarkRead={onMarkRead}
                onDismiss={onDismiss}
                onClick={() => onItemClick(it.id, it.pipelineId)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="inbox-foot">
        {items.length > 0 && unreadCount > 0 && (
          <button type="button"
            className="inbox-foot-link"
            onClick={(e) => {
              e.preventDefault();
              onMarkAllRead();
            }}
            aria-label={`全部標為已讀(${unreadCount} 則)`}
          >
            全部標為已讀
          </button>
        )}
        {items.length > 0 && (
          <button type="button"
            className="inbox-foot-link inbox-foot-link-danger"
            title="清除所有通知"
            onClick={(e) => {
              e.preventDefault();
              onDismissAll();
            }}
            aria-label={`清除全部通知(${items.length} 則)`}
          >
            清除全部通知
          </button>
        )}
      </div>
    </div>
  );
}

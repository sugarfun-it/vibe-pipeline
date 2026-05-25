import { InboxPanel } from "./InboxPanel";
import { InboxStrip } from "./InboxStrip";
// strip 改 bell + 數字 badge 一顆按鈕(取代原本 ChevronLeft 展開鈕 + 獨立 count box 兩件)。
import type { InboxFilter, InboxState, NotifItem } from "../../types/notif";

export type Common = {
  items: NotifItem[];
  filter: InboxFilter;
  setFilter: (f: InboxFilter) => void;
  unreadCount: number;
  highlightId: string | null;
  state: InboxState;
  setState: (s: InboxState) => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onMarkAllRead: () => void;
  onDismissAll: () => void;
  onItemClick: (id: string, pipelineId?: string) => void;
};

export function InboxColumn(props: Common) {
  if (props.state === "hidden") return null;
  if (props.state === "collapsed") {
    return (
      <aside className="inbox-col" aria-label="通知欄已收合" id="inbox-aside">
        <InboxStrip
          items={props.items}
          unreadCount={props.unreadCount}
          onExpand={() => props.setState("expanded")}
          onItemClick={props.onItemClick}
        />
      </aside>
    );
  }
  return (
    <aside className="inbox-col" aria-label="通知欄已展開" id="inbox-aside">
      <InboxPanel {...props} onCollapse={() => props.setState("collapsed")} />
    </aside>
  );
}

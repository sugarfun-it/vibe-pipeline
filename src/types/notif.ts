import type { NotifEventType, NotifSeverity } from "../../shared/types";

// 從 shared/ 轉發 sev 型別,讓本檔的 NotifItem 與其他 UI 元件能單點 import。
export type { NotifSeverity };

export type NotifAction = {
  label: string;
  kind?: "block" | "info";
};

// UI 顯示用的 notif 物件(InboxColumn 拿這個 render)。
// 跟持久化的 NotifRecord(shared/types.ts)不同 — 多了 primary/secondary action 等顯示輔助欄位,
// 由 BoardScreen 從 NotifRecord 投影出來。
export type NotifItem = {
  id: string;
  type?: NotifEventType;
  sev: NotifSeverity;
  title: string;
  sub: string;
  ts: string;
  unread?: boolean;
  pipelineId?: string;
  primary?: NotifAction;
  secondary?: NotifAction;
};

export type InboxState = "expanded" | "collapsed" | "hidden";
export type InboxFilter = "all" | "unread" | "blocking";

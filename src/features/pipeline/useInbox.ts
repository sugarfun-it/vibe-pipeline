import { useCallback, useEffect, useState } from "react";
import * as api from "../../api";
import { useApi } from "../../hooks/useApi";
import { useTimeout } from "../../hooks/useTimeout";
import type { InboxFilter, InboxState, NotifItem } from "../../types/notif";
import { toNotifItem } from "./notifAdapter";

export function useInbox(projectHash: string | null) {
  const [inboxState, setInboxState] = useState<InboxState>("collapsed");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [items, setItems] = useState<NotifItem[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const unreadCount = items.filter((i) => i.unread).length;

  const markRead = useCallback(
    (id: string) => {
      setItems((arr) => arr.map((it) => (it.id === id ? { ...it, unread: false } : it)));
      if (projectHash) api.markNotifRead(projectHash, id).catch(() => {});
    },
    [projectHash],
  );
  const dismissNotif = useCallback(
    (id: string) => {
      setItems((arr) => arr.filter((it) => it.id !== id));
      if (projectHash) api.dismissNotif(projectHash, id).catch(() => {});
    },
    [projectHash],
  );
  const markAllRead = useCallback(() => {
    setItems((arr) => arr.map((it) => ({ ...it, unread: false })));
    if (projectHash) api.markAllNotifsRead(projectHash).catch(() => {});
  }, [projectHash]);
  const dismissAllNotifs = useCallback(() => {
    setItems([]);
    if (projectHash) api.dismissAllNotifs(projectHash).catch(() => {});
  }, [projectHash]);
  const focusInboxItem = useCallback(
    (id: string) => {
      setInboxState("expanded");
      setHighlightId(id);
      markRead(id);
    },
    [markRead],
  );

  useTimeout(() => setHighlightId(null), highlightId ? 1600 : null, [highlightId]);

  const notifsResult = useApi(
    async () => (projectHash ? await api.listNotifs(projectHash) : null),
    { intervalMs: 10000, gate: !!projectHash, deps: [projectHash] }
  );
  useEffect(() => {
    if (!projectHash) {
      setItems([]);
      return;
    }
    if (notifsResult.data) {
      setItems(notifsResult.data.map(toNotifItem));
    }
  }, [projectHash, notifsResult.data]);

  return {
    inboxState,
    setInboxState,
    filter,
    setFilter,
    items,
    setItems,
    highlightId,
    setHighlightId,
    unreadCount,
    markRead,
    dismissNotif,
    markAllRead,
    dismissAllNotifs,
    focusInboxItem,
  };
}

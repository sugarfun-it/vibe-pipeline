import { useCallback, useState } from "react";
import type { Ticket } from "../../../../shared/types";

export function useTicketDrawer() {
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const [splittingTicketId, setSplittingTicketId] = useState<string | null>(null);
  const handleTicketClick = useCallback((t: Ticket) => setOpenTicket(t), []);

  return {
    openTicket,
    setOpenTicket,
    splittingTicketId,
    setSplittingTicketId,
    handleTicketClick,
  };
}

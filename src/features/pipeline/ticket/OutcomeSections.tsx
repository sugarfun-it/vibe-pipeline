import type { Ticket } from "../../../../shared/types";
import { IterRounds } from "../run/IterRounds";
import { Commits } from "./Commits";
import { ReadOnlyValue, Section } from "./TicketDrawerParts";

export function OutcomeSections({ ticket }: { ticket: Ticket }) {
  return (
    <>
      {ticket.iter && (
        <Section label="迭代輪次">
          <div
            className="mono tdrw-iter-summary"
            style={{
              marginBottom: ticket.iter.rounds && ticket.iter.rounds.length > 0 ? 10 : 0,
            }}
          >
            第 {ticket.iter.current} 輪 · {ticket.iter.verdicts.length} 次審核
          </div>
          {ticket.iter.rounds && ticket.iter.rounds.length > 0 && (
            <IterRounds rounds={ticket.iter.rounds} />
          )}
        </Section>
      )}
      {ticket.commits && ticket.commits.length > 0 && (
        <Section label="commit 紀錄">
          <Commits commits={ticket.commits} />
        </Section>
      )}
      {ticket.liveLog && (
        <Section label="即時日誌">
          <pre
            className="tdrw-prompt"
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {ticket.liveLog}
          </pre>
        </Section>
      )}
      {ticket.reason && (
        <Section label="原因說明">
          <ReadOnlyValue value={ticket.reason} />
        </Section>
      )}
    </>
  );
}

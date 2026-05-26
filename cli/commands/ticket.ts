import type { ParsedArgs } from "../lib/args";
import { fail, print } from "../lib/output";
import { ticketAdd } from "./ticket/add";
import { ticketList } from "./ticket/list";
import { ticketRemove } from "./ticket/remove";
import { ticketShow } from "./ticket/show";
import { ticketUpdate } from "./ticket/update";
import { TICKET_USAGE } from "./ticket/_shared";

export async function runTicket(sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (sub === "help" || args.flags["help"] === true) {
    print(TICKET_USAGE);
    return;
  }
  switch (sub) {
    case "list":   return ticketList(args);
    case "show":   return ticketShow(args);
    case "add":    return ticketAdd(args);
    case "update": return ticketUpdate(args);
    case "remove": return ticketRemove(args);
    default:
      fail("INVALID_ARGS", `Unknown ticket subcommand: ${sub ?? "(none)"}. Use list|show|add|update|remove (or 'vbpl ticket help')`);
  }
}

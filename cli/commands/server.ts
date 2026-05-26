import type { ParsedArgs } from "../lib/args";
import { fail, print } from "../lib/output";
import { serverLogs } from "./server/logs";
import { serverRestart } from "./server/restart";
import { serverStart } from "./server/start";
import { serverStatus } from "./server/status";
import { serverStop } from "./server/stop";

const SERVER_USAGE = `vbpl server — manage vibe-pipeline backend

  vbpl server start
  vbpl server stop
  vbpl server status
  vbpl server restart
  vbpl server logs [--follow|-f]`;

export { serverStart };

export async function runServer(sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (sub === "help" || args.flags["help"] === true) {
    print(SERVER_USAGE);
    return;
  }
  switch (sub) {
    case "start": return void await serverStart();
    case "stop":  return void await serverStop();
    case "status": return serverStatus();
    case "restart": return serverRestart();
    case "logs": return serverLogs(args);
    default:
      fail("INVALID_ARGS", `Unknown server subcommand: ${sub ?? "(none)"}. Use start|stop|status|restart|logs (or 'vbpl server help')`);
  }
}

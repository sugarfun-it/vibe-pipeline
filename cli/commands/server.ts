import type { ParsedArgs } from "../lib/args";
import { fail, print } from "../lib/output";
import { serverLogs } from "./server/logs";
import { serverRestart } from "./server/restart";
import { serverStart } from "./server/start";
import { serverStatus } from "./server/status";
import { serverStop } from "./server/stop";

const SERVER_USAGE = `vbpl server — manage vibe-pipeline backend

SYNOPSIS
  vbpl server <sub> [flags]

SUBCOMMANDS
  start              背景啟動 backend(detach,terminal 關掉不會殺)
  stop               停 backend(pipeline running 會被 SIGKILL → state=paused)
  status             看 backend 跑不跑 / pid / port / repo_path / version
  restart            stop + start(換 server / cli code 後同步生效)
  logs               看 backend 最近 log

OPTIONS
  --follow|-f        【logs 用】持續輸出新 log(類 tail -f)

EXAMPLES
  vbpl server start           # 啟動 backend(idempotent;已 up 則 skip)
  vbpl server status          # 看活不活
  vbpl server logs -f         # 持續看 log(debug 用)
  vbpl server restart         # 改完 server code 重啟生效

NOTES
  - backend 啟動撞 EADDRINUSE(預設 port 3001 被佔)會自動換 port,
    實際 port 寫在 ~/.vibe-pipeline/server.json。Tailscale forward 撞到
    要重新指 tailscale serve --bg --https=443 http://localhost:<新 port>
  - pipeline run/stop/merge/sync 會 auto-detect + 自動啟 local backend,
    通常不需手動 vbpl server start

SEE ALSO
  vbpl pipeline --help    # pipeline 動作會自動啟 backend
  vbpl update --help      # update 流程會 stop → swap → start backend`;

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

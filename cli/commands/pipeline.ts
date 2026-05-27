import { pipelineCreate } from "./pipeline/create";
import { pipelineDelete } from "./pipeline/delete";
import { pipelineList } from "./pipeline/list";
import { pipelineLog } from "./pipeline/log";
import { pipelineMerge } from "./pipeline/merge";
import { pipelineRun } from "./pipeline/run";
import { pipelineShow } from "./pipeline/show";
import { pipelineStatus } from "./pipeline/status";
import { pipelineStop } from "./pipeline/stop";
import { pipelineSync } from "./pipeline/sync";
import type { ParsedArgs } from "../lib/args";
import { fail, print } from "../lib/output";

const PIPELINE_USAGE = `vbpl pipeline — manage pipelines (fs ops local; run/stop/merge/sync need backend up)

SYNOPSIS
  vbpl pipeline <sub> [<id>] [flags]

SUBCOMMANDS
  list                                   列已知 pipeline(可選 --project)
  show   <id>                            看 pipeline 全文(tickets / state / commits)
  create <name>                          建新 pipeline(綁定 new branch)
  delete <id>                            砍 worktree + branch + json(預設 confirm)
  run    <id>                            backend 啟動 runner
  stop   <id>                            SIGKILL runner → state=paused
  status <id>                            即時狀態(state / tickets[].status)
  log    <id>                            執行紀錄摘要(cost / duration / verdict)
  merge  <id>                            合併回 base branch(衝突才 AI)
  sync   <id>                            把 base 拉進 pipeline worktree

OPTIONS
  --project <hash>          指定 project,預設用 server 當前 active project
  --auto-merge              【create 用】全 ticket done 自動 merge 回 base
                            預設取 project config 內的 defaults.autoMerge
                            (查:vbpl config get defaults.autoMerge);
                            加 flag = 強制開,不加 = 沿用 project 預設
  --base-branch <branch>    【create 用】base branch 名,預設 main
  --force                   【delete 用】跳過 confirm
  --follow|-f               【log 用】持續輸出新 log
  --ai                      【sync 用】衝突時讓 AI 解
  --cancel                  【sync 用】取消進行中的 sync
  --dismiss                 【sync 用】關掉 sync conflict 提示

EXAMPLES
  vbpl pipeline create my-feature                          # 沿用 project 預設 auto-merge
  vbpl pipeline create my-feature --auto-merge             # 強制開 auto-merge
  vbpl pipeline create my-feature --base-branch develop    # 從 develop 切
  vbpl pipeline status <id> --json                         # structured output 給 agent 解析
  vbpl pipeline log <id> -f                                # tail 持續看新 run

SEE ALSO
  vbpl ticket --help        # ticket 增刪改查(pipeline 內)
  vbpl config --help        # project-level defaults(autoMerge / baseBranch / iterLimit)

  <id> also accepts first positional arg.`;

export async function runPipeline(sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (sub === "help" || args.flags["help"] === true) {
    print(PIPELINE_USAGE);
    return;
  }
  switch (sub) {
    case "list":   return pipelineList(args);
    case "show":   return pipelineShow(args);
    case "create": return pipelineCreate(args);
    case "delete": return pipelineDelete(args);
    case "run":    return pipelineRun(args);
    case "stop":   return pipelineStop(args);
    case "status": return pipelineStatus(args);
    case "log":    return pipelineLog(args);
    case "merge":  return pipelineMerge(args);
    case "sync":   return pipelineSync(args);
    default:
      fail("INVALID_ARGS", `Unknown pipeline subcommand: ${sub ?? "(none)"}. Use list|create|show|delete|run|stop|status|log|merge|sync (or 'vbpl pipeline help')`);
  }
}

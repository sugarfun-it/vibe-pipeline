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

  vbpl pipeline list                          [--project <hash>]
  vbpl pipeline show   <id>                   [--project <hash>]
  vbpl pipeline create <name>                 [--auto-merge] [--base-branch <branch>]
  vbpl pipeline delete <id>                   [--force]   砍 worktree + branch + json(預設要 confirm)
  vbpl pipeline run    <id>                   (needs backend)
  vbpl pipeline stop   <id>                   (needs backend)
  vbpl pipeline status <id>
  vbpl pipeline log    <id>                   [--follow|-f]
  vbpl pipeline merge  <id>                   AI merge → base
  vbpl pipeline sync   <id>                   [--ai|--cancel|--dismiss]   base → worktree

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

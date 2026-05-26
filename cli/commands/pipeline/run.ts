import { resolveProject, requireInit } from "../../lib/project";
import { ensureBackend } from "../../lib/ensureBackend";
import { post } from "../../lib/api";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print } from "../../lib/output";

// 走 backend HTTP — spawn child(claude/codex runner)必須讓 backend 養。
// CLI 自己 spawn 會在 CLI 退出時失去 child 控制權(orchestrator running map 蒸發,watchdog / stop 都失效)
export async function pipelineRun(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline run <id>");
  await ensureBackend();

  const result = await post<{ ok: true; queued?: boolean; position?: number | null }>(
    `/api/projects/${proj.hash}/pipelines/${id}/run`
  );

  if (isJsonMode()) {
    okJson({ started: true, pipelineId: id, queued: result.queued ?? false, position: result.position ?? null });
    return;
  }
  if (result.queued) {
    print(`Pipeline queued: ${id} (position ${result.position ?? "?"})`);
  } else {
    print(`Pipeline started: ${id}`);
  }
}

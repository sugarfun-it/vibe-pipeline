import { resolveProject, requireInit } from "../../lib/project";
import { ensureBackend } from "../../lib/ensureBackend";
import { post } from "../../lib/api";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print } from "../../lib/output";

export async function pipelineStop(args: ParsedArgs): Promise<void> {
  if (args.flags["immediate"] !== undefined) fail("INVALID_ARGS", "Unknown flag: --immediate");
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline stop <id>");
  await ensureBackend();

  await post(`/api/projects/${proj.hash}/pipelines/${id}/stop`);

  if (isJsonMode()) {
    okJson({ stopped: true, pipelineId: id });
    return;
  }
  print(`Pipeline stopped: ${id}`);
}

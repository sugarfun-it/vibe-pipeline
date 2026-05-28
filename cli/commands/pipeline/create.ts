import { generatePipelineId, writePipeline } from "../../../server/lib/domain/pipeline";
import { getResolvedDefaults } from "../../../server/lib/domain/projectConfig";
import { resolveProject, requireInit } from "../../lib/project";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, printLines } from "../../lib/output";
import type { Pipeline } from "../../../shared/types";

export async function pipelineCreate(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);

  const name = args.positional[0] ?? (typeof args.flags["name"] === "string" ? args.flags["name"] : undefined);
  if (!name) fail("INVALID_ARGS", "Usage: vbpl pipeline create <name> [--base-branch <branch>] [--auto-merge]");

  const id = generatePipelineId(name);
  const defaults = await getResolvedDefaults(proj.path);
  const baseBranch = typeof args.flags["base-branch"] === "string" ? args.flags["base-branch"] : defaults.base_branch || "main";
  // auto-merge:flag 顯式給就用 flag,沒給 fallback project config defaults.auto_merge(對齊 web UI 行為)
  // --auto-merge 或 --auto-merge=true → on;--no-auto-merge 或 --auto-merge=false → off;省略 → 看 defaults
  let autoMerge: boolean;
  if (args.flags["auto-merge"] === true || args.flags["auto-merge"] === "true") {
    autoMerge = true;
  } else if (args.flags["auto-merge"] === "false" || args.flags["no-auto-merge"] === true) {
    autoMerge = false;
  } else {
    autoMerge = defaults.auto_merge;
  }
  const branch = `pipeline/${name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "")}`;

  const pipeline: Pipeline = {
    id,
    name,
    branch,
    baseBranch,
    state: "planning",
    tickets: [],
    autoMerge,
  };

  await writePipeline(proj.path, id, pipeline, {
    source: "cli-pipeline-create",
    sourceDetail: `create pipeline ${name}`,
  });

  if (isJsonMode()) {
    okJson(pipeline);
    return;
  }
  printLines([
    `Created pipeline: ${name}`,
    `  id:     ${id}`,
    `  branch: ${branch}`,
  ]);
}

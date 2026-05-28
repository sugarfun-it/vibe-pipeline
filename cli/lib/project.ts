// Resolve active project from flags or state.json lastProject.
import * as projectStore from "../../server/lib/domain/project";
import * as projectDir from "../../server/lib/domain/projectDir";
import { projectHash } from "../../server/lib/io/hash";
import { resolve } from "node:path";
import { fail } from "./output";

export type ResolvedProject = {
  path: string;
  hash: string;
};

export async function resolveProject(flags: Record<string, string | boolean>): Promise<ResolvedProject> {
  const flagHash = typeof flags["project"] === "string" ? flags["project"] : undefined;
  const flagPath = typeof flags["project-path"] === "string" ? flags["project-path"] : undefined;

  if (flagPath) {
    const abs = resolve(flagPath);
    return { path: abs, hash: projectHash(abs) };
  }

  if (flagHash) {
    const proj = await projectStore.findByHash(flagHash);
    if (!proj) fail("NO_PROJECT", `No project with hash ${flagHash}`);
    return { path: proj.path, hash: proj.hash };
  }

  const last = await projectStore.getLastProject();
  if (!last) fail("NO_PROJECT", "No active project. Use --project <hash> or --project-path <path>");
  return { path: last.path, hash: last.hash };
}

export async function requireInit(projectPath: string): Promise<void> {
  if (!projectDir.hasInit(projectPath)) {
    fail("NOT_INITIALIZED", "Project at " + projectPath + " has no .vibe-pipeline/ directory. Run 'vbpl project init --here' (or 'vbpl project init <path>') to initialize.");
  }
}

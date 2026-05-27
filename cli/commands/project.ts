import * as projectStore from "../../server/lib/projectStore";
import * as pipelineDir from "../../server/lib/pipelineDir";
import { projectHash } from "../../server/lib/hash";
import { resolve } from "node:path";
import type { ParsedArgs } from "../lib/args";
import { fail, isJsonMode, okJson, print, printLines, table } from "../lib/output";
import type { Project } from "../../shared/types";

const PROJECT_USAGE = `vbpl project — manage known projects

SYNOPSIS
  vbpl project <sub> [args] [flags]

SUBCOMMANDS
  list                    列已知 project(顯示 hash / name / path / 最後開啟時間)
  show                    看單一 project 全文(預設用最後開啟,可指定)
  add <path>              加 project 但不 init(只記錄,沒 .vibe-pipeline/)
  init <path>|--here      加 + init(建 .vibe-pipeline/ 結構)
  remove <hash|path>      從清單拔掉(不刪 fs)

OPTIONS
  --project <hash>        【show 用】指定 project hash
  --project-path <path>   【show 用】指定 project 路徑(會自動算 hash)
  --here                  【init 用】init 當前 cwd 為 project

EXAMPLES
  vbpl project list                       # 看全部 project
  vbpl project init --here                # init 當前目錄
  vbpl project init /path/to/repo         # init 指定路徑
  vbpl project show --project b2dda010    # 看單一 project 細節
  vbpl project list --json                # structured output 給 agent

SEE ALSO
  vbpl pipeline --help    # 在 project 內建 pipeline
  vbpl server --help      # backend 怎麼跟 project 互動`;

export async function runProject(sub: string | undefined, args: ParsedArgs): Promise<void> {
  if (sub === "help" || args.flags["help"] === true) {
    print(PROJECT_USAGE);
    return;
  }
  switch (sub) {
    case "list": return projectList();
    case "show": return projectShow(args);
    case "add":  return projectAdd(args);
    case "remove": return projectRemove(args);
    case "init": return projectInit(args);
    default:
      fail("INVALID_ARGS", `Unknown project subcommand: ${sub ?? "(none)"}. Use list|show|add|remove|init (or 'vbpl project help')`);
  }
}

async function projectList(): Promise<void> {
  const projects = await projectStore.listRecent();
  if (isJsonMode()) {
    okJson(projects);
    return;
  }
  if (projects.length === 0) {
    print("No projects.");
    return;
  }
  const rows: string[][] = [["HASH", "NAME", "PATH", "INIT", "BRANCH"]];
  for (const p of projects) {
    rows.push([
      p.hash,
      p.name,
      p.path,
      p.hasInit ? "yes" : "no",
      p.currentBranch ?? "-",
    ]);
  }
  printLines([table(rows)]);
}

async function projectShow(args: ParsedArgs): Promise<void> {
  const hash = typeof args.flags["project"] === "string" ? args.flags["project"] : undefined;
  const path = typeof args.flags["project-path"] === "string" ? args.flags["project-path"] : undefined;

  let proj: Project | null = null;
  if (path) {
    const abs = resolve(path);
    proj = await projectStore.findByHash(projectHash(abs));
    if (!proj) {
      // Build one on the fly even if not in state.json
      const hasInit = pipelineDir.hasInit(abs);
      proj = {
        path: abs,
        hash: projectHash(abs),
        name: abs.split(/[\\/]/).pop() ?? abs,
        hasInit,
        hasGit: false,
        lastOpenedAt: 0,
      };
    }
  } else if (hash) {
    proj = await projectStore.findByHash(hash);
    if (!proj) fail("NO_PROJECT", `No project with hash ${hash}`);
  } else {
    proj = await projectStore.getLastProject();
    if (!proj) fail("NO_PROJECT", "No active project");
  }

  if (isJsonMode()) {
    okJson(proj);
    return;
  }
  printLines([
    `hash:    ${proj!.hash}`,
    `name:    ${proj!.name}`,
    `path:    ${proj!.path}`,
    `init:    ${proj!.hasInit ? "yes" : "no"}`,
    `git:     ${proj!.hasGit ? "yes" : "no"}`,
    `branch:  ${proj!.currentBranch ?? "-"}`,
    `opened:  ${proj!.lastOpenedAt ? new Date(proj!.lastOpenedAt).toLocaleString() : "-"}`,
  ]);
}

async function projectAdd(args: ParsedArgs): Promise<void> {
  const path = args.positional[0] ?? (typeof args.flags["path"] === "string" ? args.flags["path"] : undefined);
  if (!path) fail("INVALID_ARGS", "Usage: vbpl project add <path>");
  const proj = await projectStore.open(path);
  if (isJsonMode()) {
    okJson(proj);
    return;
  }
  print(`Added project: ${proj.name} (${proj.hash})`);
  // add 只寫 state.json,不 init — 對 fresh repo 提示下一步,避免 user 以為 add 完就能 create pipeline
  if (!proj.hasInit) {
    print("");
    print("  ⚠ 此 project 尚未 init (.vibe-pipeline/ 不存在)");
    print(`  下一步: vbpl project init --project-path "${proj.path}"`);
    print("  或 cd 進去後跑: vbpl project init --here");
  }
}

async function projectInit(args: ParsedArgs): Promise<void> {
  const positional = args.positional[0];
  const here = args.flags["here"] === true;
  const rawPath = positional ?? (here ? process.cwd() : undefined);
  if (!rawPath) fail("INVALID_ARGS", "Usage: vbpl project init <path> | vbpl project init --here");
  const abs = resolve(rawPath!);

  if (pipelineDir.hasInit(abs)) {
    print("Already initialized, nothing to do");
    return;
  }

  let proj: Project;
  try {
    await pipelineDir.init(abs);
    proj = await projectStore.open(abs);
  } catch (err) {
    fail("INVALID_PATH", (err as Error).message);
    return;
  }

  if (isJsonMode()) {
    okJson({ path: abs, hash: proj.hash });
    return;
  }
  print("Initialized: " + proj.name + " (" + proj.hash + ") at " + abs);
}

async function projectRemove(args: ParsedArgs): Promise<void> {
  const hashOrPath = args.positional[0] ??
    (typeof args.flags["project"] === "string" ? args.flags["project"] : undefined) ??
    (typeof args.flags["project-path"] === "string" ? args.flags["project-path"] : undefined);

  if (!hashOrPath) fail("INVALID_ARGS", "Usage: vbpl project remove <hash|path>");

  // Try as hash first, then as path
  let proj = await projectStore.findByHash(hashOrPath);
  if (!proj) {
    const abs = resolve(hashOrPath);
    proj = await projectStore.findByHash(projectHash(abs));
  }
  if (!proj) fail("NO_PROJECT", `No project found for: ${hashOrPath}`);

  // 走 projectStore.removeRecent SSOT(atomicWriteJson + lastProject 清為 null,
  // 不像舊 inline 版自作主張 fallback 到 recentProjects[0])
  await projectStore.removeRecent(proj!.hash);

  if (isJsonMode()) {
    okJson({ removed: true, hash: proj!.hash, path: proj!.path });
    return;
  }
  print(`Removed project: ${proj!.name} (${proj!.hash})`);
}

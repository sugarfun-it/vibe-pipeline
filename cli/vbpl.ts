#!/usr/bin/env bun
// vbpl — vibe-pipeline local CLI
// Usage: bun run cli/vbpl.ts <noun> <verb> [args...] [--json]

import { parseArgs } from "./lib/args";
import { setJsonMode, fail, print } from "./lib/output";
import { runProject } from "./commands/project";
import { runPipeline } from "./commands/pipeline";
import { runTicket } from "./commands/ticket";
import { runConfig } from "./commands/config";
import { runServer } from "./commands/server";

const USAGE = `vbpl — vibe-pipeline CLI

Usage:
  vbpl project  list|show|add|remove          [--project <hash>] [--project-path <path>]
  vbpl pipeline list|create|show|delete       [--project <hash>] [--project-path <path>]
  vbpl pipeline run|stop|status|log <id>      [--project <hash>] [--follow|-f]
  vbpl pipeline merge <id>                    [--project <hash>]   AI merge → base
  vbpl pipeline sync <id> [--ai|--cancel|--dismiss]                base → worktree
  vbpl ticket   list|show|add|update|remove   --pipeline <id>    [--project <hash>]
  vbpl config   list|get|set                  [key] [value]
  vbpl server   start|stop|status|restart|logs [-f]

Global flags:
  --json               Output strict JSON (stdout only). Exit 0=ok, 1=error.
  --project <hash>     Select project by 8-char hash
  --project-path <p>   Select project by absolute path

Examples:
  vbpl project list
  vbpl pipeline list --json
  vbpl pipeline run <pipelineId>
  vbpl ticket add --pipeline <id> --title "Fix bug" --goal "..." --prompt "..." --acceptance "a;b" --mode step
  vbpl config set runner.model claude-opus-4-7
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  // --json can appear anywhere in argv
  if (args.flags["json"] === true) {
    setJsonMode(true);
    delete args.flags["json"];
  }

  const noun = args.positional[0];
  const sub = args.positional[1];
  const rest = { ...args, positional: args.positional.slice(2) };

  if (args.flags["version"] === true || args.flags["v"] === true) {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = await Bun.file(pkgUrl).json() as { version?: string };
    print(`vbpl ${pkg.version ?? "unknown"}`);
    process.exit(0);
  }

  if (!noun || noun === "--help" || noun === "help" || noun === "-h") {
    print(USAGE);
    process.exit(0);
  }

  switch (noun) {
    case "project":  await runProject(sub, rest); break;
    case "pipeline": await runPipeline(sub, rest); break;
    case "ticket":   await runTicket(sub, rest); break;
    case "config":   await runConfig(sub, rest); break;
    case "server":   await runServer(sub, rest); break;
    default:
      fail("INVALID_ARGS", `Unknown command: ${noun}. Run vbpl --help for usage.`);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (process.env["VBPL_JSON"] === "1") {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: "IO_ERROR", message: msg } }) + "\n");
  } else {
    process.stderr.write(`vbpl fatal: ${msg}\n`);
  }
  process.exit(1);
});

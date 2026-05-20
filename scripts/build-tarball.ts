#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync, cpSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const WHITELIST = [
  "dist",
  "server",
  "cli",
  "shared",
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "vite.config.ts",
  "LICENSE",
  "README.md",
];

function parseArgs(argv: string[]): { version: string; allowDirty: boolean } {
  const args = argv.slice(2);
  let allowDirty = false;
  const positional: string[] = [];
  for (const a of args) {
    if (a === "--allow-dirty") allowDirty = true;
    else positional.push(a);
  }
  if (positional.length !== 1) {
    console.error("Usage: bun run scripts/build-tarball.ts <version> [--allow-dirty]");
    console.error("  <version> e.g. v0.2.0 or 0.2.0");
    process.exit(2);
  }
  return { version: positional[0], allowDirty };
}

async function run(cmd: string[], opts: { cwd?: string; capture?: boolean } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? ROOT,
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: opts.capture ? "pipe" : "inherit",
  });
  const code = await proc.exited;
  const stdout = opts.capture && proc.stdout ? await new Response(proc.stdout).text() : "";
  const stderr = opts.capture && proc.stderr ? await new Response(proc.stderr).text() : "";
  return { code, stdout, stderr };
}

async function assertCleanTree(allowDirty: boolean): Promise<void> {
  const { code, stdout } = await run(["git", "status", "--porcelain"], { capture: true });
  if (code !== 0) {
    throw new Error("git status failed");
  }
  if (stdout.trim().length > 0) {
    if (allowDirty) {
      console.warn("[warn] working tree dirty, continuing due to --allow-dirty:");
      console.warn(stdout);
    } else {
      console.error("[fail] working tree dirty. Commit / stash first, or pass --allow-dirty:");
      console.error(stdout);
      process.exit(1);
    }
  }
}

async function assertVersionMatches(argVersion: string): Promise<string> {
  const pkgPath = join(ROOT, "package.json");
  const pkg = await Bun.file(pkgPath).json();
  const pkgVersion: string = pkg.version;
  const arg = argVersion.replace(/^v/, "");
  const pv = pkgVersion.replace(/^v/, "");
  if (arg !== pv) {
    console.error(`[fail] version mismatch: arg=${argVersion} package.json=${pkgVersion}`);
    process.exit(1);
  }
  return pv;
}

async function buildDist(): Promise<void> {
  console.log("[step] bun run build");
  const { code } = await run(["bun", "run", "build"]);
  if (code !== 0) {
    console.error("[fail] bun run build failed");
    process.exit(1);
  }
  if (!existsSync(join(ROOT, "dist"))) {
    console.error("[fail] dist/ not produced");
    process.exit(1);
  }
}

function stageWhitelist(stageDir: string): string[] {
  mkdirSync(stageDir, { recursive: true });
  const copied: string[] = [];
  for (const entry of WHITELIST) {
    const src = join(ROOT, entry);
    if (!existsSync(src)) {
      if (entry === "LICENSE") {
        console.log("[skip] LICENSE not present");
        continue;
      }
      console.error(`[fail] required entry missing: ${entry}`);
      process.exit(1);
    }
    const dst = join(stageDir, entry);
    const st = statSync(src);
    if (st.isDirectory()) {
      cpSync(src, dst, { recursive: true });
    } else {
      mkdirSync(resolve(dst, ".."), { recursive: true });
      cpSync(src, dst);
    }
    copied.push(entry);
  }
  return copied;
}

async function makeTarball(stageParent: string, dirName: string, outFile: string): Promise<void> {
  // Use relative output filename + cwd to avoid GNU tar treating "C:" as a remote host on Windows/MSYS.
  const outName = `${dirName}.tar.gz`;
  console.log(`[step] tar czf ${outName} (cwd=${stageParent})`);
  const { code } = await run(["tar", "czf", outName, dirName], { cwd: stageParent });
  if (code !== 0) {
    console.error("[fail] tar failed");
    process.exit(1);
  }
  const produced = join(stageParent, outName);
  cpSync(produced, outFile);
  rmSync(produced, { force: true });
}

async function main() {
  const { version: argVersion, allowDirty } = parseArgs(process.argv);
  await assertCleanTree(allowDirty);
  const version = await assertVersionMatches(argVersion);
  await buildDist();

  const stageParent = join(ROOT, "release-tmp");
  const dirName = `vibe-pipeline-v${version}`;
  const stageDir = join(stageParent, dirName);
  if (existsSync(stageParent)) rmSync(stageParent, { recursive: true, force: true });

  const copied = stageWhitelist(stageDir);
  console.log(`[stage] copied: ${copied.join(", ")}`);

  const outFile = join(ROOT, `vibe-pipeline-v${version}.tar.gz`);
  if (existsSync(outFile)) rmSync(outFile, { force: true });
  await makeTarball(stageParent, dirName, outFile);

  console.log("");
  console.log(`Done. Tarball: ${outFile}`);
  console.log(`Next: gh release create v${version} --title v${version} --notes-file docs/release/v${version}.md ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

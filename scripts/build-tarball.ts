#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync, cpSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

// Backend runtime deps(實際 grep server/ + cli/ + shared/ import 結果):
//   - server/ → otpauth + qrcode-svg(其餘是 node: / bun: built-in)
//   - cli/    → 0 npm deps
//   - shared/ → 0 npm deps
// frontend deps(firebase / react / workbox-* runtime / 等)build-time 才用,
// 已 bundle 進 dist/,enduser tarball 不必帶 source npm package。
const ENDUSER_RUNTIME_DEPS = ["otpauth", "qrcode-svg"];

const WHITELIST = [
  "dist",
  "server",
  "cli",
  "shared",
  // scripts/ ship 進來原因:backend /api/system/update spawn install.{ps1,sh} 需要 local
  // script(避 GitHub raw fallback 的 args 傳遞坑)。順手帶 uninstall script,user 從 install
  // dir 也能拔。build-tarball.ts 自己也在這 dir 但 user 不會誤跑。
  "scripts",
  "package.json",
  "bun.lock",
  "tsconfig.json",
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

// 拔掉 dev / build deps + 跟前端 build 相關的「dependencies」(實際只 frontend 用,
// 已 bundle 進 dist/)。enduser tarball 內 package.json 只剩 backend 真正需要的 2 個。
// 順手砍 scripts 只留 enduser 會用到的(server / vbpl)。
async function stripStagePackageJson(stageDir: string): Promise<void> {
  const pkgPath = join(stageDir, "package.json");
  const orig = (await Bun.file(pkgPath).json()) as {
    name?: string;
    version?: string;
    private?: boolean;
    type?: string;
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const stripped: Record<string, unknown> = {
    name: orig.name,
    version: orig.version,
    private: orig.private,
    type: orig.type,
    scripts: {
      server: orig.scripts?.server,
      vbpl: orig.scripts?.vbpl,
    },
    dependencies: {} as Record<string, string>,
  };
  // 從原 package.json 拿真實版本號(避免 build script 自己 maintain 一份號)
  for (const dep of ENDUSER_RUNTIME_DEPS) {
    const v = orig.dependencies?.[dep];
    if (!v) {
      console.error(`[fail] runtime dep "${dep}" missing in root package.json dependencies`);
      process.exit(1);
    }
    (stripped.dependencies as Record<string, string>)[dep] = v;
  }
  writeFileSync(pkgPath, JSON.stringify(stripped, null, 2) + "\n", "utf8");
  console.log(`[strip] package.json deps: ${ENDUSER_RUNTIME_DEPS.join(", ")}(原 ${Object.keys(orig.dependencies ?? {}).length} → ${ENDUSER_RUNTIME_DEPS.length})`);

  // bun.lock 是 root maintainer 版的 lockfile,跟 stripped package.json 不匹配,刪掉
  // bun install 會根據新 package.json 重生
  const lockPath = join(stageDir, "bun.lock");
  if (existsSync(lockPath)) {
    rmSync(lockPath, { force: true });
    console.log("[strip] removed stale bun.lock(會在 stage 內 bun install 時重生)");
  }
}

// 在 stage dir 跑 bun install,populate node_modules + 生新 bun.lock。
// 目的:enduser install 時 tarball 內已預裝好 deps,不必跑 30-60s bun install。
async function preinstallInStage(stageDir: string): Promise<void> {
  console.log("[step] bun install in stage(pre-populate node_modules)");
  const { code } = await run(["bun", "install", "--silent"], { cwd: stageDir });
  if (code !== 0) {
    console.error("[fail] bun install in stage failed");
    process.exit(1);
  }
  if (!existsSync(join(stageDir, "node_modules"))) {
    console.error("[fail] node_modules not produced in stage");
    process.exit(1);
  }
  console.log("[stage] node_modules populated");
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

  // 拔 dev / frontend deps,留 enduser 真正需要的 → 預裝 node_modules
  await stripStagePackageJson(stageDir);
  await preinstallInStage(stageDir);

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

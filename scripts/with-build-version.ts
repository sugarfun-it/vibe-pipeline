// 跨平台 wrapper:跑 git describe / rev-parse 拿版本字串,
// 設 BUILD_VERSION env 後 spawn 子命令(沿用 stdio)。
// 子命令 args 內 "{BUILD_VERSION}" placeholder 會被替換,避免依賴 shell 變數展開(sh vs cmd)。
// Usage: bun run scripts/with-build-version.ts -- <command> [...args]

import { spawnSync } from "node:child_process";

function detectVersion(): string {
  const d = spawnSync("git", ["describe", "--tags", "--always", "--dirty"], {
    encoding: "utf8",
  });
  if (d.status === 0 && d.stdout.trim().length > 0) return d.stdout.trim();
  const s = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  if (s.status === 0 && s.stdout.trim().length > 0) return s.stdout.trim();
  return "unknown";
}

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const cmdArgs = sep >= 0 ? args.slice(sep + 1) : args;
if (cmdArgs.length === 0) {
  console.error("usage: with-build-version.ts -- <cmd> [...args]");
  process.exit(2);
}

const version = detectVersion();
const substituted = cmdArgs.map((a) => a.split("{BUILD_VERSION}").join(version));
const child = spawnSync(substituted[0], substituted.slice(1), {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, BUILD_VERSION: version },
});
process.exit(child.status ?? 1);

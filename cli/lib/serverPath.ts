import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { vibeHome } from "../../server/lib/io/paths";
import { fail } from "./output";

export type ServerInfo = {
  repo_path: string;
  pid?: number;
  port?: number;
  log_path?: string;
  started_at?: number;
};

const PACKAGE_NAME = "vibe-pipeline";

export function serverStateDir(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

export function serverJsonPath(): string {
  return join(serverStateDir(), "server.json");
}

export function serverPidPath(): string {
  return join(serverStateDir(), "server.pid");
}

export function serverLogPath(): string {
  return join(serverStateDir(), "server.log");
}

async function readPackageName(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

async function isVibePipelineRepo(dir: string): Promise<boolean> {
  return (await readPackageName(dir)) === PACKAGE_NAME;
}

async function resolveRepoPath(dir: string): Promise<string | null> {
  const repoPath = resolve(dir);
  if (!(await isVibePipelineRepo(repoPath))) return null;
  return repoPath;
}

async function detectFromCwd(cwd = process.cwd()): Promise<string | null> {
  let dir = resolve(cwd);
  while (true) {
    if (existsSync(join(dir, ".git")) && (await isVibePipelineRepo(dir))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function detectFromEnv(): Promise<string | null> {
  const envPath = process.env["VBPL_HOME"];
  if (!envPath) return null;
  const repoPath = await resolveRepoPath(envPath);
  if (!repoPath) {
    fail("NO_SERVER_REPO", `VBPL_HOME 不是 vibe-pipeline repo:${resolve(envPath)}`);
  }
  return repoPath;
}

async function detectFromRemembered(): Promise<string | null> {
  try {
    const parsed = await readServerInfo();
    if (!parsed) return null;
    return await resolveRepoPath(parsed.repo_path);
  } catch {
    return null;
  }
}

export async function detectServerRepoPath(): Promise<string> {
  // VBPL_HOME is an explicit override so packaged vbpl can be run from any cwd.
  const fromEnv = await detectFromEnv();
  if (fromEnv) return fromEnv;

  const fromCwd = await detectFromCwd();
  if (fromCwd) return fromCwd;

  const fromRemembered = await detectFromRemembered();
  if (fromRemembered) return fromRemembered;

  fail(
    "NO_SERVER_REPO",
    "找不到 vibe-pipeline repo。請讓 AI 設 VBPL_HOME 指向 VP repo,或 cd 進 VP repo 後再跑。",
  );
}

export async function readServerInfo(): Promise<ServerInfo | null> {
  try {
    const raw = await readFile(serverJsonPath(), "utf8");
    const parsed = JSON.parse(raw) as {
      repo_path?: unknown;
      pid?: unknown;
      port?: unknown;
      log_path?: unknown;
      started_at?: unknown;
    };
    if (typeof parsed.repo_path !== "string" || parsed.repo_path.length === 0) return null;
    return {
      repo_path: parsed.repo_path,
      pid: typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : undefined,
      port: typeof parsed.port === "number" && Number.isInteger(parsed.port) && parsed.port > 0 ? parsed.port : undefined,
      log_path: typeof parsed.log_path === "string" && parsed.log_path.length > 0 ? parsed.log_path : undefined,
      started_at: typeof parsed.started_at === "number" && Number.isFinite(parsed.started_at) ? parsed.started_at : undefined,
    };
  } catch {
    return null;
  }
}

export async function rememberServerRepoPath(repoPath: string, info: Partial<Omit<ServerInfo, "repo_path">> = {}): Promise<void> {
  await mkdir(serverStateDir(), { recursive: true });
  const state: ServerInfo = { repo_path: repoPath, ...info };
  await writeFile(serverJsonPath(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

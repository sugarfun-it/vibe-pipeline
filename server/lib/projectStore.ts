import { join, basename, resolve } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { projectHash } from "./hash";
import { vibeHome } from "./paths";
import { atomicWriteJson } from "./atomicWrite";
import type { Project } from "../../shared/types";

// 注意:不要 cache 這條 path。e2e 一次 process 內 VP_HOME_OVERRIDE 不變但抽 function 比較乾淨,
// 也讓未來 multi-tenant / per-request 切 home 不用大改。
function stateDir(): string {
  return join(vibeHome(), ".vibe-pipeline");
}
function stateFile(): string {
  return join(stateDir(), "state.json");
}

type State = {
  lastProject: string | null;
  recentProjects: Array<{ path: string; lastOpenedAt: number }>;
};

const EMPTY_STATE: State = { lastProject: null, recentProjects: [] };

async function readState(): Promise<State> {
  if (!existsSync(stateFile())) return EMPTY_STATE;
  try {
    const text = await Bun.file(stateFile()).text();
    const parsed = JSON.parse(text);
    return {
      lastProject: typeof parsed.lastProject === "string" ? parsed.lastProject : null,
      recentProjects: Array.isArray(parsed.recentProjects) ? parsed.recentProjects : [],
    };
  } catch {
    return EMPTY_STATE;
  }
}

async function writeState(state: State): Promise<void> {
  if (!existsSync(stateDir())) mkdirSync(stateDir(), { recursive: true });
  await atomicWriteJson(stateFile(), state);
}

// 純 fs metadata,**不**呼 git。currentBranch 是裝飾用(TopBar 顯 chip),
// 每次 list / status 都 spawn git 不划算。要顯示就走另一 endpoint lazy fetch。
function toProject(path: string, lastOpenedAt: number): Project {
  const absolute = resolve(path);
  const dirPath = join(absolute, ".vibe-pipeline");
  const hasInit = existsSync(dirPath) && statSync(dirPath).isDirectory();
  const hasGit = existsSync(join(absolute, ".git"));
  return {
    path: absolute,
    hash: projectHash(absolute),
    name: basename(absolute),
    hasInit,
    hasGit,
    lastOpenedAt,
  };
}

export async function listRecent(): Promise<Project[]> {
  const state = await readState();
  const sorted = [...state.recentProjects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return Promise.all(sorted.map((r) => toProject(r.path, r.lastOpenedAt)));
}

export async function getLastProject(): Promise<Project | null> {
  const state = await readState();
  if (!state.lastProject) return null;
  const entry = state.recentProjects.find((r) => r.path === state.lastProject);
  if (!entry) return null;
  return toProject(state.lastProject, entry.lastOpenedAt);
}

export async function findByHash(hash: string): Promise<Project | null> {
  const state = await readState();
  for (const r of state.recentProjects) {
    if (projectHash(r.path) === hash) return toProject(r.path, r.lastOpenedAt);
  }
  return null;
}

// 從 recent list 移掉 hash 對應 entry。冪等:不存在回 removed:false,存在回 removed:true。
// 只動 state.json,不碰 project 本身 fs(不 rm worktree、不刪 .vibe-pipeline/)。
// lastProject 指到該 entry 的話一併清(避免 dangling reference)。
export async function removeRecent(hash: string): Promise<{ removed: boolean }> {
  const state = await readState();
  const idx = state.recentProjects.findIndex((r) => projectHash(r.path) === hash);
  if (idx === -1) return { removed: false };
  const [removedEntry] = state.recentProjects.splice(idx, 1);
  if (removedEntry && state.lastProject === removedEntry.path) {
    state.lastProject = null;
  }
  await writeState(state);
  return { removed: true };
}

export async function open(path: string): Promise<Project> {
  const absolute = resolve(path);
  const now = Date.now();
  const state = await readState();
  state.lastProject = absolute;
  const existing = state.recentProjects.find((r) => r.path === absolute);
  if (existing) existing.lastOpenedAt = now;
  else state.recentProjects.push({ path: absolute, lastOpenedAt: now });
  await writeState(state);
  return toProject(absolute, now);
}

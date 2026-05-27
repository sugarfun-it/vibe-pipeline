import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { API_BASE } from "./api-base";

export type TempProject = {
  path: string;
  hash: string;
};

const API = API_BASE;

// Run git deterministically:設 user.name/email + -b baseBranch,避免吃 user 全域 git config 出 surprise。
export function gitIn(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "vp-e2e",
      GIT_AUTHOR_EMAIL: "vp-e2e@local",
      GIT_COMMITTER_NAME: "vp-e2e",
      GIT_COMMITTER_EMAIL: "vp-e2e@local",
    },
  });
  return {
    ok: res.status === 0,
    out: res.stdout ?? "",
    err: res.stderr ?? "",
  };
}

// 建一個 temp git repo + .vibe-pipeline/(可選 seed pipelines),註冊進 backend recents。
// 回 path + hash,後續 spec 用 ?project=<hash> 進 board。
//
// seed pipeline 排序契約:**seed array 順序 = 新增順序**,index 0 = 最舊、index N-1 = 最新。
// 未顯式帶 createdAt 的 pipeline 一律 backfill 遞增 ts,確保 backend listPipelines
// (用 createdAt 倒序)拿到的「最新」= seed[N-1],UI 預設 active 行為才穩定。
// 若 spec 自己給 createdAt 則尊重(spec 自控)。
export async function createTempProject(opts?: {
  baseBranch?: string;
  pipelines?: Array<Record<string, unknown>>;
}): Promise<TempProject> {
  const baseBranch = opts?.baseBranch ?? "main";
  const dir = mkdtempSync(join(tmpdir(), "vp-e2e-proj-"));

  const init = gitIn(dir, ["init", "-b", baseBranch]);
  if (!init.ok) throw new Error(`git init failed: ${init.err}`);
  writeFileSync(join(dir, "README.md"), "# vp-e2e fixture\n");
  // .vibe-pipeline/ 一律 ignore — register-project 會在 .vibe-pipeline/ 寫 config + pipeline json,
  // 不寫 .gitignore 會讓 merge / sync dirty preflight 全卡 untracked。
  writeFileSync(join(dir, ".gitignore"), ".vibe-pipeline/\n");
  const add = gitIn(dir, ["add", "."]);
  if (!add.ok) throw new Error(`git add failed: ${add.err}`);
  const commit = gitIn(dir, ["commit", "-m", "init"]);
  if (!commit.ok) throw new Error(`git commit failed: ${commit.err}`);

  const rawPipelines = opts?.pipelines ?? [];
  const now = Date.now();
  const N = rawPipelines.length;
  const seedPipelines = rawPipelines.map((p, i) => {
    if (typeof p.createdAt === "number") return p;
    return { ...p, createdAt: now - (N - 1 - i) * 1000 };
  });

  const res = await fetch(`${API}/__test/register-project`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      path: dir,
      ensureInit: true,
      seedPipelines,
    }),
  });
  const body = (await res.json()) as { ok: boolean; data?: { hash: string }; error?: { message: string } };
  if (!body.ok || !body.data) {
    throw new Error(`register-project failed: ${body.error?.message ?? "unknown"}`);
  }
  return { path: dir, hash: body.data.hash };
}

// 砍 fixture dir。worktrees 在 VP_HOME_OVERRIDE,留給 OS tmp 自然回收。
export function cleanupTempProject(p: TempProject): void {
  try {
    rmSync(p.path, { recursive: true, force: true });
  } catch {
    // ignore — OS 會清 tmp
  }
}

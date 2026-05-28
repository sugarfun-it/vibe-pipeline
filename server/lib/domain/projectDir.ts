// .vibe-pipeline/ 目錄結構 + gitignore + worktreeinclude 模板。
// 不碰 config.json — 由 projectConfig.writeConfig 處理。

import { join } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";

const DIR = ".vibe-pipeline";
const GITIGNORE_ENTRIES = [`${DIR}/`];

export function rootPath(projectPath: string): string {
  return join(projectPath, DIR);
}

export function runtimePath(projectPath: string, sub = ""): string {
  return join(rootPath(projectPath), ".runtime", sub);
}

export function ensureRuntime(projectPath: string, sub = ""): string {
  const p = runtimePath(projectPath, sub);
  mkdirSync(p, { recursive: true });
  return p;
}

export function hasInit(projectPath: string): boolean {
  const p = rootPath(projectPath);
  return existsSync(p) && statSync(p).isDirectory();
}

// idempotent:`.vibe-pipeline/` 已存在但內容缺(早期 partial init 失敗留的殘骸)→ 補齊;
// 全齊 → 也視為成功(no-op),不再 throw 'already_initialized'。
// 只在 path 存在但不是 dir(被檔案佔住等)時 throw。
// 不再寫 config.json — projectConfig.writeConfig 負責。
export async function init(projectPath: string): Promise<void> {
  const root = rootPath(projectPath);
  if (existsSync(root) && !statSync(root).isDirectory()) {
    throw new Error(".vibe-pipeline path is not a directory");
  }
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "pipelines"), { recursive: true });
  mkdirSync(join(root, ".runtime"), { recursive: true });
  for (const entry of GITIGNORE_ENTRIES) {
    await ensureGitignoreEntry(projectPath, entry);
  }
  await ensureWorktreeIncludeTemplate(projectPath);
}

// 開 worktree 時 git 只帶 tracked 檔,.env 等 gitignored 憑證不會進 worktree
// → AI 找不到會 hardcode。.worktreeinclude 列出要一起複製的 gitignored 檔(見 worktree.ts)。
// init 只放「全註解模板」:純 discoverability,VP 不猜這個 repo 該複製什麼。
// 已存在(含 Claude Code / user 自己寫的)→ 完全不碰。
const WORKTREE_INCLUDE_TEMPLATE = `# worktree 複製清單 — 開 worktree 時要一起帶進去的 gitignored 檔
# 用 .gitignore 語法;只有「match 且本身被 gitignore」的檔會被複製(tracked 檔自動排除)。
# 取消下面註解並改成這個 repo 實際的憑證 / 環境檔:
# .env
# .env.local
`;

async function ensureWorktreeIncludeTemplate(projectPath: string): Promise<void> {
  const wti = join(projectPath, ".worktreeinclude");
  if (existsSync(wti)) return;
  await Bun.write(wti, WORKTREE_INCLUDE_TEMPLATE);
}

async function ensureGitignoreEntry(projectPath: string, entry: string): Promise<void> {
  const gi = join(projectPath, ".gitignore");
  let content = "";
  if (existsSync(gi)) content = await Bun.file(gi).text();
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry)) return;
  const next = (content.endsWith("\n") || content === "" ? content : content + "\n") + entry + "\n";
  await Bun.write(gi, next);
}

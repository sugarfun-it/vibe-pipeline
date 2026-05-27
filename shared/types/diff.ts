// ─── Worktree diff(server/lib/git/worktree.ts 算 / frontend 顯示) ───
export type DiffStat = { files: number; added: number; deleted: number };
export type DiffFile = { path: string; added: number; deleted: number };
export type FullDiff = { files: DiffFile[]; raw: string };


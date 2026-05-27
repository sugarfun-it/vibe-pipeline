export type Project = {
  path: string; // absolute
  hash: string; // sha256(path).slice(0, 8)
  name: string; // basename(path)
  hasInit: boolean; // .vibe-pipeline/ 是否存在
  hasGit: boolean; // .git/ 是否存在(runner 階段需要)
  lastOpenedAt: number; // unix ms
  currentBranch?: string; // 當前 git HEAD 短名(`git symbolic-ref --short HEAD`),非 git repo 為 undefined
  defaultBaseBranch?: string; // config.defaults.base_branch(沒設則 fallback 當前 git branch)
  costLimitUsd?: number; // config.defaults.cost_limit_usd(0 = 無限)
};

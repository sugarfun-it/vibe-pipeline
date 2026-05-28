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

// Project config 的 API 契約(GET / PUT /api/projects/:hash/config 的回傳形狀)。
// 單一定義源:前端 api/project.ts 與後端 projectConfig.ResolvedDefaults / route 同 import 本檔,
// 不各自重定義漂走。注意這是「已 resolve 過的回傳形狀」(四欄必填),
// 跟磁碟上 config.json 的持久化形狀(欄位多 optional,server projectConfig.ProjectConfig)不同物件。
export type ProjectConfigDefaults = {
  base_branch: string;
  max_parallel: number;
  cost_limit_usd: number;
  auto_merge: boolean;
};

export type ProjectConfig = {
  defaults: ProjectConfigDefaults;
};

// PUT patch body。讀走 base_branch、寫走 default_base_branch 是後端讀寫不同 key 的刻意設計,
// 保留語意差異,只去重型別。
export type ProjectConfigPatch = {
  defaults?: {
    max_parallel?: number;
    default_base_branch?: string;
    cost_limit_usd?: number;
    auto_merge?: boolean;
  };
};

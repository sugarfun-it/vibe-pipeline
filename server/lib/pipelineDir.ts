// BARREL re-export(commit A 後過渡,commit D 刪)。
// 新 code 請直接從 domain/projectDir | projectConfig | pipeline | mergeTicket import。

export {
  rootPath,
  runtimePath,
  ensureRuntime,
  hasInit,
  init,
} from "./domain/projectDir";

export {
  DEFAULT_MAX_PARALLEL,
  MAX_PARALLEL_MIN,
  MAX_PARALLEL_MAX,
  FIXED_MERGE_STRATEGY,
  DEFAULT_COST_LIMIT_USD,
  DEFAULT_AUTO_MERGE,
  readConfig,
  writeConfig,
  clampMaxParallel,
  getMaxParallel,
  normalizeCostLimitUsd,
  getResolvedDefaults,
} from "./domain/projectConfig";
export type { ProjectConfig, ResolvedDefaults } from "./domain/projectConfig";

export {
  generatePipelineId,
  pipelineFile,
  listPipelines,
  readPipeline,
  writePipeline,
  mutatePipeline,
  deletePipeline,
} from "./domain/pipeline";

export { appendMergeTicket } from "./domain/mergeTicket";

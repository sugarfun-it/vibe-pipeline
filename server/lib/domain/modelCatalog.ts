import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Effort, ModelCatalog, ModelName, Provider } from "../../../shared/types";
import { BUNDLED_CATALOG, PROVIDERS } from "../../../shared/types";
import { vibeHome } from "../io/paths";

let snapshot: ModelCatalog = BUNDLED_CATALOG;

export function cachePath(): string {
  return join(vibeHome(), ".vibe-pipeline", "models-catalog.json");
}

function isNonEmptyStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.length > 0);
}

export function validateCatalog(raw: unknown): ModelCatalog | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== "string") return null;
  const models = o.models as Record<string, unknown> | undefined;
  const efforts = o.efforts as Record<string, unknown> | undefined;
  if (!models || !efforts) return null;
  for (const p of PROVIDERS) {
    if (!isNonEmptyStrArray(models[p])) return null;
    if (!isNonEmptyStrArray(efforts[p])) return null;
  }
  return {
    version: o.version,
    models: { claude: models.claude as string[], codex: models.codex as string[] },
    efforts: { claude: efforts.claude as string[], codex: efforts.codex as string[] },
  };
}

export function hydrateFromCacheSync(): void {
  try {
    const txt = readFileSync(cachePath(), "utf8");
    const parsed = validateCatalog(JSON.parse(txt));
    if (parsed) snapshot = parsed;
  } catch {
    // 無快取 / 毀損 → 維持 bundled
  }
}

export function setSnapshot(c: ModelCatalog): void {
  snapshot = c;
}

export function getCatalog(): ModelCatalog {
  return snapshot;
}
export function getModels(p: Provider): readonly ModelName[] {
  return snapshot.models[p] ?? BUNDLED_CATALOG.models[p];
}
export function getEfforts(p: Provider): readonly Effort[] {
  return snapshot.efforts[p] ?? BUNDLED_CATALOG.efforts[p];
}
export function getDefaultModel(p: Provider): ModelName {
  return getModels(p)[0];
}
export function isValidModel(p: Provider, m: string): boolean {
  return getModels(p).includes(m);
}
export function isValidEffort(p: Provider, e: string): boolean {
  return getEfforts(p).includes(e);
}

// module load 即同步 hydrate(backend & CLI 都不必顯式呼叫)
hydrateFromCacheSync();

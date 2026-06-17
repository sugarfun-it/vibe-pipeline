import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Effort, ModelCatalog, ModelName, Provider } from "../../../shared/types";
import { BUNDLED_CATALOG, PROVIDERS } from "../../../shared/types";
import { vibeHome } from "../io/paths";
import { atomicWriteJson } from "../io/atomicWrite";

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

const DEFAULT_URL =
  "https://raw.githubusercontent.com/sugarfun-it/vibe-pipeline/main/catalog/models.json";
const TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export function catalogUrl(): string {
  return process.env.VP_MODEL_CATALOG_URL || DEFAULT_URL;
}

export async function refresh(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(catalogUrl(), { signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      console.warn(`[modelCatalog] fetch ${res.status}, 維持現狀`);
      return false;
    }
    const parsed = validateCatalog(await res.json());
    if (!parsed) {
      console.warn("[modelCatalog] 遠端 shape 不合法,維持現狀");
      return false;
    }
    setSnapshot(parsed);
    try {
      mkdirSync(join(vibeHome(), ".vibe-pipeline"), { recursive: true });
      await atomicWriteJson(cachePath(), parsed);
    } catch (e) {
      console.warn("[modelCatalog] 寫快取失敗(snapshot 已更新):", e);
    }
    return true;
  } catch (e) {
    console.warn("[modelCatalog] refresh 失敗:", e);
    return false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startRefresh(): void {
  void refresh();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void refresh(), TTL_MS);
}

// module load 即同步 hydrate(backend & CLI 都不必顯式呼叫)
hydrateFromCacheSync();

# 遠端 model/effort catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把可選的 model / effort 清單從 hardcode 搬到 maintainer public repo 的一份 JSON,backend HTTP GET + 快取,新 model 出現只需 push JSON、零發版。

**Architecture:** 新 `server/lib/domain/modelCatalog.ts` 持一份 in-memory snapshot(sync getter 供 backend 驗證 / CLI 用),module 載入時同步從快取檔 hydrate,backend boot 後非同步 fetch 遠端 + TTL refresh 更新 snapshot。前端走新 `GET /api/catalog`。三層 fallback:remote → 快取檔 → bundled const(`shared/types/user.ts` 保留)。

**Tech Stack:** Bun(`bun:test`)、TypeScript、React、現有 `atomicWriteJson` / `vibeHome()` / `server/router.ts` pathname dispatch。

## Global Constraints

- Catalog URL hardcode,pin `main`:`https://raw.githubusercontent.com/sugarfun-it/vibe-pipeline/main/catalog/models.json`;可被 env `VP_MODEL_CATALOG_URL` override(forker / 測試用),不接受 runtime 任意輸入。
- JSON shape:`{ version: string(ISO date), models: {claude:string[], codex:string[]}, efforts: {claude:string[], codex:string[]} }`;每 array `[0]` = 該 provider 預設。
- model id 原封傳給 CLI,不轉換(claude 全名 / codex OpenAI 命名)。
- 任何 fetch / 快取失敗都不得 throw,靜默退回下一層 fallback;backend log warn 一行。
- `DEFAULT_USER_CONFIG` 維持 bundled,不進遠端 JSON。
- 快取檔:`${vibeHome()}/.vibe-pipeline/models-catalog.json`。
- 測試指令:`bun test <file>`。Sub-test 隔離靠 `VP_HOME_OVERRIDE`(導 ~/.vibe-pipeline 到 tmp)+ `VP_MODEL_CATALOG_URL`。
- TTL 6h;fetch timeout 5s。
- token 走 tokens.css(本 feature 無新顏色)。server prompt template literal 規則不涉及本 feature。

---

### Task 1: Catalog 資料檔 + 型別 + bundled const

**Files:**
- Create: `catalog/models.json`
- Modify: `shared/types/user.ts`(在 `EFFORTS_BY_PROVIDER` 定義之後加型別與 const)
- Test: `shared/types/modelCatalog.test.ts`

**Interfaces:**
- Produces: `type ModelCatalog = { version: string; models: Record<Provider, readonly ModelName[]>; efforts: Record<Provider, readonly Effort[]> }`;`const BUNDLED_CATALOG: ModelCatalog`。

- [ ] **Step 1: 寫 catalog/models.json**(內容 = 現行 const 值)

```json
{
  "version": "2026-06-18",
  "models": {
    "claude": [
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-opus-4-6"
    ],
    "codex": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"]
  },
  "efforts": {
    "claude": ["low", "medium", "high", "xhigh", "max"],
    "codex": ["minimal", "low", "medium", "high"]
  }
}
```

- [ ] **Step 2: 寫 failing test** `shared/types/modelCatalog.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { BUNDLED_CATALOG, type ModelCatalog } from "./user";
import catalogJson from "../../catalog/models.json";

describe("ModelCatalog bundled", () => {
  test("BUNDLED_CATALOG 跟現行 const 對齊", () => {
    expect(BUNDLED_CATALOG.models.claude[0]).toBe("claude-opus-4-8");
    expect(BUNDLED_CATALOG.efforts.codex).toContain("minimal");
  });
  test("catalog/models.json 跟 BUNDLED_CATALOG 同內容", () => {
    const fromFile = catalogJson as ModelCatalog;
    expect(fromFile.models).toEqual(BUNDLED_CATALOG.models as ModelCatalog["models"]);
    expect(fromFile.efforts).toEqual(BUNDLED_CATALOG.efforts as ModelCatalog["efforts"]);
  });
});
```

- [ ] **Step 3: Run test → fail**

Run: `bun test shared/types/modelCatalog.test.ts`
Expected: FAIL（`BUNDLED_CATALOG` 未 export）

- [ ] **Step 4: 在 `shared/types/user.ts` 加型別 + const**(`EFFORTS_BY_PROVIDER` 定義之後)

```ts
export type ModelCatalog = {
  version: string;
  models: Record<Provider, readonly ModelName[]>;
  efforts: Record<Provider, readonly Effort[]>;
};

// 最終 fallback:remote / 快取都失敗時用這份(= 上面兩個 const)。
export const BUNDLED_CATALOG: ModelCatalog = {
  version: "bundled",
  models: MODELS_BY_PROVIDER,
  efforts: EFFORTS_BY_PROVIDER,
};
```

- [ ] **Step 5: 確認 tsconfig 允許 import json**

Run: `bunx tsc --noEmit`
Expected: 0 errors。若報 json import 錯,在 `tsconfig.json` `compilerOptions` 確認 `"resolveJsonModule": true`(Bun 預設支援;缺則加)。

- [ ] **Step 6: Run test → pass**

Run: `bun test shared/types/modelCatalog.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add catalog/models.json shared/types/user.ts shared/types/modelCatalog.test.ts
git commit -m "feat(catalog): 加 ModelCatalog 型別 + bundled const + models.json"
```

---

### Task 2: modelCatalog 載入器核心(snapshot + sync getter + 驗證 + 同步 hydrate)

**Files:**
- Create: `server/lib/domain/modelCatalog.ts`
- Test: `server/lib/domain/modelCatalog.test.ts`

**Interfaces:**
- Consumes: `ModelCatalog`, `BUNDLED_CATALOG`（Task 1）;`vibeHome()`（`server/lib/io/paths`）。
- Produces:
  - `getCatalog(): ModelCatalog`
  - `getModels(p: Provider): readonly ModelName[]`
  - `getEfforts(p: Provider): readonly Effort[]`
  - `getDefaultModel(p: Provider): ModelName`
  - `isValidModel(p: Provider, m: string): boolean`
  - `isValidEffort(p: Provider, e: string): boolean`
  - `validateCatalog(raw: unknown): ModelCatalog | null`
  - `cachePath(): string`
  - `hydrateFromCacheSync(): void`（module load 時自動呼一次)

- [ ] **Step 1: 寫 failing test** `server/lib/domain/modelCatalog.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "vpcat-"));
  process.env.VP_HOME_OVERRIDE = home;
});
afterEach(() => {
  delete process.env.VP_HOME_OVERRIDE;
  rmSync(home, { recursive: true, force: true });
});

describe("validateCatalog", () => {
  test("好 shape → 回 catalog", async () => {
    const mc = await import("./modelCatalog?vc1");
    const ok = mc.validateCatalog({
      version: "2026-06-18",
      models: { claude: ["claude-opus-4-8"], codex: ["gpt-5.5"] },
      efforts: { claude: ["low"], codex: ["minimal"] },
    });
    expect(ok?.models.claude[0]).toBe("claude-opus-4-8");
  });
  test.each([
    [{}, "缺欄位"],
    [{ version: "x", models: { claude: [] }, efforts: {} }, "claude 空 array"],
    [{ version: "x", models: { claude: ["a"], codex: ["b"] }, efforts: { claude: ["x"] } }, "efforts 缺 codex"],
    [{ version: 1, models: { claude: ["a"], codex: ["b"] }, efforts: { claude: ["x"], codex: ["y"] } }, "version 非 string"],
  ])("壞 shape → null (%#)", async (raw) => {
    const mc = await import("./modelCatalog?vc2");
    expect(mc.validateCatalog(raw)).toBeNull();
  });
});

describe("hydrate + sync getters", () => {
  test("無快取 → getter 回 bundled", async () => {
    const mc = await import("./modelCatalog?h1");
    expect(mc.getModels("claude")[0]).toBe("claude-opus-4-8");
  });
  test("有快取檔 → hydrate 後 getter 回快取值", async () => {
    mkdirSync(join(home, ".vibe-pipeline"), { recursive: true });
    writeFileSync(
      join(home, ".vibe-pipeline", "models-catalog.json"),
      JSON.stringify({
        version: "2030-01-01",
        models: { claude: ["claude-future-9"], codex: ["gpt-9"] },
        efforts: { claude: ["low"], codex: ["minimal"] },
      })
    );
    const mc = await import("./modelCatalog?h2");
    mc.hydrateFromCacheSync();
    expect(mc.getModels("claude")[0]).toBe("claude-future-9");
    expect(mc.getDefaultModel("codex")).toBe("gpt-9");
    expect(mc.isValidModel("claude", "claude-future-9")).toBe(true);
    expect(mc.isValidModel("claude", "claude-opus-4-8")).toBe(false);
  });
});
```

> 註:`?h1`/`?vc1` query suffix 讓每個 test 拿到「剛載入、未被別的 test 改 snapshot」的 module 實例(Bun module cache key 含 query),避免共享 in-memory snapshot 互污染。

- [ ] **Step 2: Run test → fail**

Run: `bun test server/lib/domain/modelCatalog.test.ts`
Expected: FAIL（modelCatalog 不存在)

- [ ] **Step 3: 寫 `server/lib/domain/modelCatalog.ts`**

```ts
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
```

- [ ] **Step 4: Run test → pass**

Run: `bun test server/lib/domain/modelCatalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/domain/modelCatalog.ts server/lib/domain/modelCatalog.test.ts
git commit -m "feat(catalog): modelCatalog 載入器核心(snapshot/sync getter/驗證/hydrate)"
```

---

### Task 3: 遠端 fetch + 快取寫入(refresh / startRefresh)

**Files:**
- Modify: `server/lib/domain/modelCatalog.ts`
- Test: `server/lib/domain/modelCatalog.test.ts`（加 describe）

**Interfaces:**
- Consumes: `validateCatalog`, `setSnapshot`, `cachePath`, `getCatalog`（Task 2）;`atomicWriteJson`（`server/lib/io/atomicWrite`）。
- Produces:
  - `async refresh(): Promise<boolean>`（成功更新 snapshot+快取回 true;失敗回 false 不 throw)
  - `startRefresh(): void`（立即 refresh 一次 + 每 TTL 重抓)
  - `catalogUrl(): string`

- [ ] **Step 1: 寫 failing test**（append 到 modelCatalog.test.ts）

```ts
describe("refresh", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("fetch 成功 → 更新 snapshot + 寫快取", async () => {
    process.env.VP_MODEL_CATALOG_URL = "https://example.test/models.json";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          version: "2031-02-02",
          models: { claude: ["claude-x1"], codex: ["gpt-x1"] },
          efforts: { claude: ["high"], codex: ["high"] },
        }),
        { status: 200 }
      )) as typeof fetch;
    const mc = await import("./modelCatalog?r1");
    const ok = await mc.refresh();
    expect(ok).toBe(true);
    expect(mc.getModels("claude")[0]).toBe("claude-x1");
    const cached = await import("node:fs").then((fs) => fs.readFileSync(mc.cachePath(), "utf8"));
    expect(JSON.parse(cached).models.claude[0]).toBe("claude-x1");
    delete process.env.VP_MODEL_CATALOG_URL;
  });

  test("fetch 非 200 → 回 false,snapshot 不變", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const mc = await import("./modelCatalog?r2");
    const before = mc.getModels("claude")[0];
    expect(await mc.refresh()).toBe(false);
    expect(mc.getModels("claude")[0]).toBe(before);
  });

  test("fetch throw → 回 false 不爆", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const mc = await import("./modelCatalog?r3");
    expect(await mc.refresh()).toBe(false);
  });

  test("回壞 shape → 回 false", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: "x" }), { status: 200 })) as typeof fetch;
    const mc = await import("./modelCatalog?r4");
    expect(await mc.refresh()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `bun test server/lib/domain/modelCatalog.test.ts`
Expected: FAIL（`refresh` 不存在)

- [ ] **Step 3: 在 modelCatalog.ts 加 fetch 邏輯**（檔尾 `hydrateFromCacheSync()` 呼叫之前）

```ts
import { atomicWriteJson } from "../io/atomicWrite";

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
```

> 註:`atomicWriteJson` 內部走 `${path}.tmp` → rename;若 `~/.vibe-pipeline` 目錄不存在,確認 `atomicWriteJson` 會建。若不會,refresh 寫入前加 `mkdirSync(join(vibeHome(), ".vibe-pipeline"), { recursive: true })`(import from node:fs)。

- [ ] **Step 4: Run test → pass**

Run: `bun test server/lib/domain/modelCatalog.test.ts`
Expected: PASS（全部 describe）

- [ ] **Step 5: Commit**

```bash
git add server/lib/domain/modelCatalog.ts server/lib/domain/modelCatalog.test.ts
git commit -m "feat(catalog): refresh 遠端 fetch + 快取寫入 + TTL startRefresh"
```

---

### Task 4: `GET /api/catalog` 路由 + 路由註冊 + boot 啟動 refresh

**Files:**
- Create: `server/routes/catalog.ts`
- Modify: `server/router.ts`（加 pathname dispatch）
- Modify: `server/index.ts`（boot 呼 `startRefresh()`）
- Test: `server/routes/catalog.test.ts`

**Interfaces:**
- Consumes: `getCatalog`, `startRefresh`（Task 3）;`ok`（`server/routes/_http`)。
- Produces: `async getCatalog(): Promise<Response>`（route handler,名稱避開與 lib 撞:export 為 `getCatalogRoute`)。

- [ ] **Step 1: 寫 failing test** `server/routes/catalog.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { getCatalogRoute } from "./catalog";

describe("GET /api/catalog handler", () => {
  test("回 ok envelope 含 models/efforts", async () => {
    const res = await getCatalogRoute();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.models.claude.length).toBeGreaterThan(0);
    expect(body.data.efforts.codex.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `bun test server/routes/catalog.test.ts`
Expected: FAIL（catalog route 不存在)

- [ ] **Step 3: 寫 `server/routes/catalog.ts`**

```ts
import { getCatalog } from "../lib/domain/modelCatalog";
import { ok } from "./_http";

export async function getCatalogRoute(): Promise<Response> {
  return ok(getCatalog());
}
```

- [ ] **Step 4: Run test → pass**

Run: `bun test server/routes/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: 在 `server/router.ts` 註冊**(參照 `/api/user/config` GET 那段,line ~155 附近加)

先在檔頭 import 區加:
```ts
import { getCatalogRoute } from "./routes/catalog";
```
在 `/api/user/config` GET 判斷之前或之後加:
```ts
  if (pathname === "/api/catalog" && method === "GET") {
    return getCatalogRoute();
  }
```

- [ ] **Step 6: 在 `server/index.ts` boot 啟動 refresh**

檔頭 import:
```ts
import { startRefresh } from "./lib/domain/modelCatalog";
```
在 server 啟動(`Bun.serve` 之後 / 既有 boot 區,跟 `recoverStale` 同層級)加:
```ts
startRefresh();
```
> 找現有 boot 副作用呼叫處(grep `recoverStale(` 或 `Bun.serve`),把 `startRefresh()` 放同一段。

- [ ] **Step 7: 驗證整合**

Run: `bunx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 8: Commit**

```bash
git add server/routes/catalog.ts server/routes/catalog.test.ts server/router.ts server/index.ts
git commit -m "feat(catalog): GET /api/catalog 路由 + boot startRefresh"
```

---

### Task 5: backend 驗證改讀 modelCatalog(取代 shared const)

**Files:**
- Modify: `server/lib/domain/userConfig.ts`（line 26-30 的 import + 用處）
- Test: `server/lib/domain/userConfig.catalog.test.ts`

**Interfaces:**
- Consumes: modelCatalog 的 `isValidModel` / `isValidEffort` / `modelsForProvider`(=`getModels`)/ `effortsForProvider`(=`getEfforts`)/ `defaultModelForProvider`(=`getDefaultModel`)。
- Produces: 行為改變 —— `patchUserConfig` / `loadUserConfig` 對「快取 catalog 內、但 bundled 無」的 model 視為合法。

- [ ] **Step 1: 寫 failing test** `server/lib/domain/userConfig.catalog.test.ts`

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "vpuc-"));
  process.env.VP_HOME_OVERRIDE = home;
  mkdirSync(join(home, ".vibe-pipeline"), { recursive: true });
  // 快取 catalog 含一個 bundled 沒有的 model
  writeFileSync(
    join(home, ".vibe-pipeline", "models-catalog.json"),
    JSON.stringify({
      version: "2031-01-01",
      models: { claude: ["claude-future-9", "claude-opus-4-8"], codex: ["gpt-5.5"] },
      efforts: { claude: ["low", "medium", "high"], codex: ["minimal", "low", "medium", "high"] },
    })
  );
});
afterEach(() => {
  delete process.env.VP_HOME_OVERRIDE;
  rmSync(home, { recursive: true, force: true });
});

test("patchUserConfig 接受快取 catalog 內的新 model", async () => {
  const mc = await import("./modelCatalog");
  mc.hydrateFromCacheSync();
  const userConfig = await import("./userConfig");
  const next = await userConfig.patchUserConfig({
    defaults: { runner: { provider: "claude", model: "claude-future-9", effort: "high" } },
  });
  expect(next.defaults.runner.model).toBe("claude-future-9");
});
```

- [ ] **Step 2: Run test → fail**

Run: `bun test server/lib/domain/userConfig.catalog.test.ts`
Expected: FAIL（現在驗證走 bundled const,`claude-future-9` 被拒)

- [ ] **Step 3: 改 `server/lib/domain/userConfig.ts` import**

把現有(line 26-30 附近)從 `../../../shared/types` import 的這幾個:
`defaultModelForProvider, effortsForProvider, isValidEffort, isValidModel, modelsForProvider`
改成從 modelCatalog 取(名稱對映):
```ts
import {
  getDefaultModel as defaultModelForProvider,
  getEfforts as effortsForProvider,
  getModels as modelsForProvider,
  isValidEffort,
  isValidModel,
} from "./modelCatalog";
```
其餘只從 shared 留型別(`ModelName` / `Effort` / `Provider` / `TaskClass` / `TaskModelConfig` / `DEFAULT_USER_CONFIG` 等)的 import 不動。確認檔內所有用到的 `isValidModel` 等呼叫處(line 59-67、176-234)簽名一致(都是 `(provider, value)`),不需改 call site。

- [ ] **Step 4: Run test → pass**

Run: `bun test server/lib/domain/userConfig.catalog.test.ts`
Expected: PASS

- [ ] **Step 5: 回歸既有 userConfig 行為**

Run: `bunx tsc --noEmit && bun test server/routes/_http.test.ts server/lib/domain/modelCatalog.test.ts`
Expected: 0 errors + 全 PASS（確認沒破壞既有 import）。
> CLI(`cli/commands/config.ts`)走 `userConfig.patchUserConfig`,且 modelCatalog module load 自動 hydrate 快取 → CLI 自動吃到動態 catalog,無需改 CLI。

- [ ] **Step 6: Commit**

```bash
git add server/lib/domain/userConfig.ts server/lib/domain/userConfig.catalog.test.ts
git commit -m "feat(catalog): userConfig 驗證改讀 modelCatalog(動態清單)"
```

---

### Task 6: 前端 api + hook + AITab 下拉改吃 /api/catalog

**Files:**
- Create: `src/api/catalog.ts`
- Create: `src/features/settings/useModelCatalog.ts`
- Modify: `src/features/settings/AITab.tsx`(下拉的 `modelsForProvider` / `effortsForProvider` 來源)
- Test: `bunx tsc --noEmit` + `bun run build`(此 repo 前端無 React 單元測試設施;邏輯保持 trivial,gate 走 typecheck+build+人工/e2e)

**Interfaces:**
- Consumes: `ModelCatalog`, `BUNDLED_CATALOG`, `Provider`（shared）;`call`（`src/api/_client`)。
- Produces:
  - `getCatalog(): Promise<ModelCatalog>`（api）
  - `useModelCatalog(): { models(p): readonly string[]; efforts(p): readonly string[] }`（hook,載入前回 bundled)

- [ ] **Step 1: 寫 `src/api/catalog.ts`**

```ts
import type { ModelCatalog } from "../../shared/types";
import { call } from "./_client";

export function getCatalog(): Promise<ModelCatalog> {
  return call<ModelCatalog>("/api/catalog");
}
```

- [ ] **Step 2: 寫 `src/features/settings/useModelCatalog.ts`**

```ts
import { useEffect, useState } from "react";
import { BUNDLED_CATALOG, type ModelCatalog, type Provider } from "../../../shared/types";
import { getCatalog } from "../../api/catalog";

export function useModelCatalog() {
  const [cat, setCat] = useState<ModelCatalog>(BUNDLED_CATALOG);
  useEffect(() => {
    let alive = true;
    getCatalog()
      .then((c) => {
        if (alive) setCat(c);
      })
      .catch(() => {
        // fetch 失敗 → 維持 bundled
      });
    return () => {
      alive = false;
    };
  }, []);
  return {
    models: (p: Provider): readonly string[] => cat.models[p] ?? BUNDLED_CATALOG.models[p],
    efforts: (p: Provider): readonly string[] => cat.efforts[p] ?? BUNDLED_CATALOG.efforts[p],
  };
}
```

- [ ] **Step 3: 改 `AITab.tsx`**

移除從 shared import 的 `modelsForProvider` / `effortsForProvider`(line 7 附近),改在 `AITab` 元件內呼 hook,並把 row 用到的清單透過 props/context 傳給渲染下拉的子元件。最小改法:
- 在 `AITab` component body 加 `const catalog = useModelCatalog();`(import from `./useModelCatalog`)。
- 把 `catalog.models` / `catalog.efforts` 傳到渲染那兩個 `<select>` 的子元件(目前直接呼 `modelsForProvider(provider)` 的位置,line 70 / 86)。
- 子元件內 `modelsForProvider(provider)` → `models(provider)`、`effortsForProvider(provider)` → `efforts(provider)`(其中 `models`/`efforts` 由 prop 傳入)。
- option label 維持 `m.replace(/^claude-/, "")`。

> 若 row 子元件與 `AITab` 距離較遠導致 prop drilling 太深,可在 `AITab` 用一個小 context(`ModelCatalogContext`)包住 rows;但若只差一層,直接傳 prop。保持 YAGNI。

- [ ] **Step 4: typecheck + build**

Run: `bunx tsc --noEmit && bun run build`
Expected: 0 errors;build 成功。

- [ ] **Step 5: 人工驗證(prod-like)**

啟 `bun run start`,開 `http://127.0.0.1:3001` → Settings → AI tab,確認 model / effort 下拉正常顯示(network 有打 `/api/catalog`)。臨時把 `catalog/models.json` 加一個假 model + 設 `VP_MODEL_CATALOG_URL` 指到本機檔(或直接改快取檔)→ 重開 → 下拉出現該 model,驗證動態生效。
> 不需重啟正在跑的 prod backend;此為 dev clone 驗證。

- [ ] **Step 6: Commit**

```bash
git add src/api/catalog.ts src/features/settings/useModelCatalog.ts src/features/settings/AITab.tsx
git commit -m "feat(catalog): 前端 AITab 下拉改吃 /api/catalog(fallback bundled)"
```

---

## 收尾

- [ ] **全測回歸**:`bun test server/lib/domain/modelCatalog.test.ts server/routes/catalog.test.ts server/lib/domain/userConfig.catalog.test.ts shared/types/modelCatalog.test.ts` 全 PASS;`bunx tsc --noEmit` 0 errors。
- [ ] **更新 CHANGELOG**:`docs/CHANGELOG.md` 加一條(遠端 model catalog,maintainer 改 model 只需 push `catalog/models.json`)。
- [ ] **維護動線文件**:在 `vibe-pipeline` SKILL 或 README 加一句「新 model:編 `catalog/models.json` + push main,enduser backend TTL 內自動吃到」。
- [ ] merge `feat/remote-model-catalog` → main(走既有 merge 流程)。

## Self-Review notes

- Spec coverage:資料來源(T1)、載入器三層 fallback(T2)、TTL/ETag-less refresh(T3,採 timeout+重抓,未實作 ETag 304 —— spec 列為 optional,本版略過以免增複雜度;若要再開 task)、出口 API+前端(T4/T6)、驗證(T5)、CLI(T5 註:免改)、測試(各 task)、錯誤處理(T2/T3 fallback)、信任邊界(T3 URL hardcode+env override)。
- ETag 304 spec 寫 optional;本計畫**不做**(降複雜度),改為「過期就重抓整份」。若日後要省頻寬再補。已在此標明,非遺漏。

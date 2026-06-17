import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as mc from "./modelCatalog";
import { BUNDLED_CATALOG } from "../../../shared/types";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "vpcat-"));
  process.env.VP_HOME_OVERRIDE = home;
  mc.setSnapshot(BUNDLED_CATALOG);
});
afterEach(() => {
  delete process.env.VP_HOME_OVERRIDE;
  rmSync(home, { recursive: true, force: true });
  mc.setSnapshot(BUNDLED_CATALOG);
});

describe("validateCatalog", () => {
  test("好 shape → 回 catalog", async () => {
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
    expect(mc.validateCatalog(raw)).toBeNull();
  });
});

describe("refresh", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    mc.setSnapshot(BUNDLED_CATALOG);
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
      )) as unknown as typeof fetch;
    const ok = await mc.refresh();
    expect(ok).toBe(true);
    expect(mc.getModels("claude")[0]).toBe("claude-x1");
    const cached = readFileSync(mc.cachePath(), "utf8");
    expect(JSON.parse(cached).models.claude[0]).toBe("claude-x1");
    delete process.env.VP_MODEL_CATALOG_URL;
  });

  test("fetch 非 200 → 回 false,snapshot 不變", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const before = mc.getModels("claude")[0];
    expect(await mc.refresh()).toBe(false);
    expect(mc.getModels("claude")[0]).toBe(before);
  });

  test("fetch throw → 回 false 不爆", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await mc.refresh()).toBe(false);
  });

  test("回壞 shape → 回 false", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: "x" }), { status: 200 })) as unknown as typeof fetch;
    expect(await mc.refresh()).toBe(false);
  });
});

describe("hydrate + sync getters", () => {
  test("無快取 → getter 回 bundled", async () => {
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
    mc.hydrateFromCacheSync();
    expect(mc.getModels("claude")[0]).toBe("claude-future-9");
    expect(mc.getDefaultModel("codex")).toBe("gpt-9");
    expect(mc.isValidModel("claude", "claude-future-9")).toBe(true);
    expect(mc.isValidModel("claude", "claude-opus-4-8")).toBe(false);
  });
});

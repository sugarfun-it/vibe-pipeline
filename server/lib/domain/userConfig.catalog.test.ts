import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "vpuc-"));
  process.env.VP_HOME_OVERRIDE = home;
  mkdirSync(join(home, ".vibe-pipeline"), { recursive: true });
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

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

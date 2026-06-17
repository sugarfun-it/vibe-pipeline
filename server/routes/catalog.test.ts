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

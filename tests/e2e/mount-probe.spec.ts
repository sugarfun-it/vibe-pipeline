import { test, expect } from "@playwright/test";

const PROJECT_HASH = "1876248b";

// 已知 mount-time endpoint(每個應該只 fire 1 次)。若 fail 表示:
//  - SW first install 又開始 force reload(swUpdate.ts hadController flag regression)
//  - 某 useApi 用 object ref 當 deps(BoardScreen pipelines/config/branches 已全 primitive)
//  - 某 useEffect deps refire(api.status setProject 拿新 ref 觸發下游 refetch)
// 加新 mount endpoint 才該動 expected 集合。
const EXPECTED_MOUNT_ENDPOINTS = new Set([
  "/api/health",
  "/api/auth/status",
  "/api/projects",
  "/api/projects/<H>/qa/drafts",
  "/api/projects/<H>/status",
  "/api/projects/<H>/notifs",
  "/api/projects/<H>/config",
  "/api/projects/<H>/pipelines",
  "/api/projects/<H>/pipelines/<P>/runs",
  "/api/projects/<H>/pipelines/<P>/diff-stat",
  "/api/projects/<H>/pipelines/<P>/sync-status",
]);

test("mount-time request fire pattern @mount", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const reqs: { t: number; url: string }[] = [];
  const start = Date.now();
  page.on("request", (req) => {
    const u = req.url();
    if (!u.includes("/api/")) return;
    reqs.push({ t: Date.now() - start, url: u.replace(/.*\/api\//, "/api/") });
  });

  await page.addInitScript((hash) => {
    try { localStorage.setItem("vibe-pipeline:lastProjectHash", hash); } catch {}
  }, PROJECT_HASH);
  await page.goto(`/board?project=${PROJECT_HASH}&pipeline=019e41177fc7-verify-flicker-fix`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(5000);

  console.log(`\n=== ${reqs.length} requests in 5s ===`);
  const byEndpointAll: Record<string, number> = {};
  for (const r of reqs) {
    const path = r.url.replace(/\/api\/projects\/[a-f0-9]{8}/, "/api/projects/<H>").replace(/\/pipelines\/[a-z0-9-]+/, "/pipelines/<P>");
    byEndpointAll[path] = (byEndpointAll[path] || 0) + 1;
  }
  for (const [p, c] of Object.entries(byEndpointAll).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}× ${p}`);
  }

  // assertion 只看 mount 後 1500ms 內的 request — 避開 intervalMs polling 第二輪(health/pipelines
  // 5s interval 第二輪會落在 ~5000ms 點)。原 bug(SW first-install force reload + object ref deps)
  // 在 T=217 + T=417 重複 fire,都在 mount 1s 內。1500ms window 抓得到,不會誤報 polling。
  const mountWindow = reqs.filter((r) => r.t < 1500);
  const byEndpointMount: Record<string, number> = {};
  for (const r of mountWindow) {
    const path = r.url.replace(/\/api\/projects\/[a-f0-9]{8}/, "/api/projects/<H>").replace(/\/pipelines\/[a-z0-9-]+/, "/pipelines/<P>");
    byEndpointMount[path] = (byEndpointMount[path] || 0) + 1;
  }

  // assertion 1:mount 1.5s 內每個 endpoint 只該 fire 1 次
  // 若 ≥ 2 → SW first install force reload 回頭(swUpdate.ts hadController flag regression)
  //       / object ref deps 又出現(useApi `[project]` → setProject 觸發 trigger refire)
  const duplicates = Object.entries(byEndpointMount).filter(([, c]) => c >= 2);
  expect(duplicates, `mount 1.5s 內不該有 endpoint fire ≥ 2 次:${duplicates.map(([p, c]) => `${c}× ${p}`).join(", ")}`).toEqual([]);

  // assertion 2:沒新冒出 unknown endpoint(以 5s 全窗為基礎,polling endpoint 也算)
  const unknown = Object.keys(byEndpointAll).filter((p) => !EXPECTED_MOUNT_ENDPOINTS.has(p));
  expect(unknown, `5s 內出現未預期 endpoint(加新 endpoint 要同步更新 EXPECTED_MOUNT_ENDPOINTS):${unknown.join(", ")}`).toEqual([]);
});

import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";

const PROJECT_HASH = "1876248b";
const PAUSED_PIPELINE = "019e40b31763-auto-update";
const MERGED_PIPELINE = "019e41177fc7-verify-flicker-fix";

// regression upper bounds(只算 git.exe 新生 process — 真實 backend spawn 信號;
// conhost / OpenConsole 是 system 為任何 console app 自動配,跨 app 雜訊太多排除)
// 架構修完(metadata 拔 currentBranch + branches lazy + sync 排除 merged + useApi deps primitive
// + dedupe + SW first-install)後 baseline(8s window):
//   paused pipeline mount:diff-stat + sync-status 各 1 次,git.exe 內部 fork ~3 helper × 2 = ~6
//   merged pipeline mount:diff/sync 都 gate=false 不 fetch → ~0 git(其他 endpoint 不 spawn git)
// 8s 短窗避 polling 第二輪 + system 背景雜訊。fail 表示有 endpoint 又開始 spawn git — 別放寬,挖。
const MAX_PAUSED_MOUNT_GIT = 10;
const MAX_MERGED_MOUNT_GIT = 2;

// 只算 git.exe — backend spawn 真實信號。conhost / OpenConsole / bash / cmd 是 system 為各種
// console app 自動配,跨 app 雜訊太多。
async function snapshotGitPids(): Promise<Set<number>> {
  return new Promise((resolve) => {
    const ps = spawn("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-Process -Name git -EA SilentlyContinue | Select-Object -ExpandProperty Id",
    ]);
    let out = "";
    ps.stdout.on("data", (d: Buffer) => (out += d.toString()));
    ps.on("close", () => {
      const ids = new Set<number>();
      for (const line of out.split("\n")) {
        const id = Number(line.trim());
        if (id) ids.add(id);
      }
      resolve(ids);
    });
  });
}

async function monitorNewGitSpawns(durMs: number, baseline: Set<number>): Promise<number> {
  const seen = new Set<number>();
  return new Promise((resolve) => {
    const mon = spawn("powershell.exe", [
      "-NoProfile",
      "-Command",
      "while($true) { Get-Process -Name git -EA SilentlyContinue | Select-Object -ExpandProperty Id | Out-String -Stream; Start-Sleep -Milliseconds 30 }",
    ]);
    mon.stdout.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        const id = Number(line.trim());
        if (id && !baseline.has(id) && !seen.has(id)) {
          seen.add(id);
        }
      }
    });
    setTimeout(() => {
      mon.kill();
      resolve(seen.size);
    }, durMs);
  });
}

test("spawn count for paused pipeline mount @spawn", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript((hash) => {
    try { localStorage.setItem("vibe-pipeline:lastProjectHash", hash); } catch {}
  }, PROJECT_HASH);

  const baseline = await snapshotGitPids();

  // 8s window:含 mount 完整 burst(diff-stat + sync-status fetch ~500ms),
  // 短到避 polling 第二輪(diff 10s / sync 30s gate=running 不打)+ 避 system 背景 git 雜訊
  const monitorPromise = monitorNewGitSpawns(8000, baseline);
  await page.goto(`/board?project=${PROJECT_HASH}&pipeline=${PAUSED_PIPELINE}`);
  const newGit = await monitorPromise;
  console.log(`paused mount 8s NEW git.exe = ${newGit}(threshold ${MAX_PAUSED_MOUNT_GIT})`);

  await ctx.close();

  expect(newGit, `paused pipeline mount 不該 spawn > ${MAX_PAUSED_MOUNT_GIT} 個 git(架構修了 metadata/branches/sync;若 fail 表示有 endpoint 順手呼 git 回來了)`).toBeLessThanOrEqual(MAX_PAUSED_MOUNT_GIT);
});

test("spawn count for merged pipeline mount @spawn", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript((hash) => {
    try { localStorage.setItem("vibe-pipeline:lastProjectHash", hash); } catch {}
  }, PROJECT_HASH);

  const baseline = await snapshotGitPids();

  // merged pipeline:diffStatEnabled=false + syncEnabled=false → mount 不該 fetch git endpoint
  // 若 fail 表示 sync-status 又開始打 merged(f379e93 fix regression)或別處新 endpoint 漏 gate
  const monitorPromise = monitorNewGitSpawns(8000, baseline);
  await page.goto(`/board?project=${PROJECT_HASH}&pipeline=${MERGED_PIPELINE}`);
  const newGit = await monitorPromise;
  console.log(`merged mount 8s NEW git.exe = ${newGit}(threshold ${MAX_MERGED_MOUNT_GIT})`);

  await ctx.close();

  expect(newGit, `merged pipeline mount 不該 spawn > ${MAX_MERGED_MOUNT_GIT} 個 git(diff/sync 都 gate=false,git 操作不該觸發)`).toBeLessThanOrEqual(MAX_MERGED_MOUNT_GIT);
});

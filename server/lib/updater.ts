// /api/system/update 後端核心(tarball 模式):
// - preflightCheck:兩條(無 pipeline running / hasUpdate)任一失敗回 reason。
//   git clean 檢查已拔 — enduser 安裝走 `~/.vibe-pipeline/app/`,沒 .git/。
// - performUpdate:
//   1. fetch GitHub releases/latest 取 tarball URL(優先 release asset .tar.gz / .zip,
//      fallback `tarball_url` 自動源 tarball)+ tag
//   2. 下載到 `~/.vibe-pipeline/app.download.tmp/release.tar.gz`(或 .zip)
//   3. 解壓到 staging dir,單一頂層 dir → 視為 root
//   4. rm -rf `~/.vibe-pipeline/app/`,mv staging root → `~/.vibe-pipeline/app/`
//   5. 失敗任一步直接拋,純前進不 rollback(spec C 決議)
//   6. cleanup tmp / staging
// - spawnNewBackend:Bun.spawn(["bun","run","server/index.ts"], { cwd: app dir, detached:true })
// - 全程 log append 到 `~/.vibe-pipeline/update.log`(truncate 模式,只留本次)

import { join, basename } from "node:path";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, renameSync, readdirSync, statSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { platform } from "node:os";
import { vibeHome } from "./paths";
import { getVersionStatus, fetchLatestRelease } from "./systemVersion";
import * as orchestrator from "./runner/orchestrator";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

function vpRoot(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

export function updateLogPath(): string {
  return join(vpRoot(), "update.log");
}

export function appDir(): string {
  return join(vpRoot(), "app");
}

function downloadDir(): string {
  return join(vpRoot(), "app.download.tmp");
}

function stagingDir(): string {
  return join(vpRoot(), "app.staging");
}

function ensureVpRoot(): void {
  try {
    mkdirSync(vpRoot(), { recursive: true });
  } catch {
    // ignore
  }
}

function resetLog(): void {
  ensureVpRoot();
  try {
    writeFileSync(updateLogPath(), `[updater] start ${new Date().toISOString()}\n`, "utf8");
  } catch {
    // ignore
  }
}

function log(msg: string): void {
  try {
    appendFileSync(updateLogPath(), `[updater] ${msg}\n`, "utf8");
  } catch {
    // ignore
  }
}

export async function preflightCheck(): Promise<PreflightResult> {
  // 1. 沒 pipeline running(ticket / sync 都算)
  const n = orchestrator.globalRunningCount();
  if (n > 0) {
    return { ok: false, reason: `還有 ${n} 條 pipeline 在跑,等跑完或暫停後再更新` };
  }
  // 2. 有 update
  const ver = await getVersionStatus();
  if (!ver.hasUpdate) {
    return { ok: false, reason: "已是最新版,無需更新" };
  }
  return { ok: true };
}

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type ReleaseInfo = {
  tag: string;
  downloadUrl: string;
  filename: string;
  needsStripTopLevel: boolean;
};

const GITHUB_REPO = process.env.VP_GITHUB_REPO ?? "eric14304/vibe-pipeline";

// 取 release:優先 asset (.tar.gz / .zip),fallback `tarball_url`。
// asset 視為已打平 layout(maintainer 自己組);tarball_url 是 GitHub 自動產的源 tarball,
// 解壓會有 owner-repo-<sha>/ 一層,要 strip。
async function fetchReleaseInfo(): Promise<ReleaseInfo> {
  const latest = await fetchLatestRelease();
  if (!latest) {
    throw new Error("無法取得 GitHub latest release(沒發過 release / 網路 / rate limit)");
  }
  // fetchLatestRelease 沒回 assets / tarball_url,直接再打一次拿原 JSON
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "vibe-pipeline",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases/latest HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    tag_name?: string;
    tarball_url?: string;
    assets?: ReleaseAsset[];
  };
  const tag = typeof json.tag_name === "string" ? json.tag_name : latest.tag;
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const asset =
    assets.find((a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".tar.gz")) ??
    assets.find((a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".tgz")) ??
    assets.find((a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".zip"));
  if (asset && typeof asset.browser_download_url === "string") {
    return {
      tag,
      downloadUrl: asset.browser_download_url,
      filename: asset.name,
      needsStripTopLevel: false,
    };
  }
  if (typeof json.tarball_url === "string" && json.tarball_url.length > 0) {
    return {
      tag,
      downloadUrl: json.tarball_url,
      filename: `${tag}.tar.gz`,
      needsStripTopLevel: true,
    };
  }
  throw new Error("release 沒 .tar.gz / .zip asset 也沒 tarball_url");
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { "User-Agent": "vibe-pipeline" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    throw new Error(`下載失敗 HTTP ${res.status} ${url}`);
  }
  await new Promise<void>((resolve, reject) => {
    const sink = createWriteStream(dest);
    const src = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    src.on("error", reject);
    sink.on("error", reject);
    sink.on("finish", resolve);
    src.pipe(sink);
  });
}

async function runTool(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [outBuf, errBuf, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  if (outBuf.trim()) log(`stdout: ${outBuf.trim()}`);
  if (errBuf.trim()) log(`stderr: ${errBuf.trim()}`);
  if (code !== 0) {
    throw new Error(`${args.join(" ")} 失敗 exit=${code}`);
  }
}

async function extractArchive(archivePath: string, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    await runTool(["tar", "-xzf", archivePath, "-C", outDir], outDir);
    return;
  }
  if (lower.endsWith(".zip")) {
    if (platform() === "win32") {
      await runTool(
        [
          "powershell.exe",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(outDir)} -Force`,
        ],
        outDir
      );
    } else {
      // unzip 不存在的話也試試 tar -xf(bsdtar 可以)
      await runTool(["tar", "-xf", archivePath, "-C", outDir], outDir);
    }
    return;
  }
  throw new Error(`不支援的封存格式:${basename(archivePath)}`);
}

// 解壓後若 outDir 只有一個 top-level dir,把它當 root
function resolveRoot(outDir: string, forceStrip: boolean): string {
  const entries = readdirSync(outDir).filter((n) => n !== "." && n !== "..");
  if (entries.length === 1) {
    const inner = join(outDir, entries[0]);
    try {
      if (statSync(inner).isDirectory()) return inner;
    } catch {
      // ignore
    }
  }
  if (forceStrip) {
    throw new Error(`tarball 預期單一 top-level dir,實際 ${entries.length} 個 entries`);
  }
  return outDir;
}

function rmrf(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (e) {
    log(`rmSync ${path} 警告:${String(e)}`);
  }
}

export async function performUpdate(): Promise<{ tag: string; appPath: string }> {
  ensureVpRoot();
  resetLog();
  log(`repo=${GITHUB_REPO}`);
  // 清理上次殘留
  rmrf(downloadDir());
  rmrf(stagingDir());
  mkdirSync(downloadDir(), { recursive: true });

  const rel = await fetchReleaseInfo();
  log(`tag=${rel.tag} url=${rel.downloadUrl} stripTop=${rel.needsStripTopLevel}`);

  const archivePath = join(downloadDir(), rel.filename);
  log(`download → ${archivePath}`);
  await downloadToFile(rel.downloadUrl, archivePath);

  log(`extract → ${stagingDir()}`);
  await extractArchive(archivePath, stagingDir());
  const root = resolveRoot(stagingDir(), rel.needsStripTopLevel);
  log(`root=${root}`);

  // 純前進:rm app/ → mv root → app/
  const target = appDir();
  log(`rm ${target}`);
  rmrf(target);
  log(`mv ${root} → ${target}`);
  renameSync(root, target);

  // cleanup
  rmrf(downloadDir());
  rmrf(stagingDir());

  log(`done tag=${rel.tag} appPath=${target}`);
  return { tag: rel.tag, appPath: target };
}

// detached 起新 backend from 新 app dir。
// 不接 stdio,讓新 process 自己活;Bun 在 detached:true 時不會跟 parent exit 聯動。
export function spawnNewBackend(cwd: string): void {
  log(`spawn new backend from ${cwd}`);
  try {
    Bun.spawn(["bun", "run", "server/index.ts"], {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
      windowsHide: true,
      // @ts-expect-error Bun 支援 detached 選項但 TS 型別未必載入
      detached: true,
    });
  } catch (e) {
    log(`spawn 失敗:${String(e)}`);
    throw e;
  }
}

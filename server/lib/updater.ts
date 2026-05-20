// /api/system/update 後端核心(2026-05-21 第 3 版,Scoop-style versioned + swap-on-start):
//
// 前 2 版踩過:
//   v1 direct rmrf cwd → Windows EBUSY 自殺
//   v2 launcher helper script → 8 個 Windows-specific 雷(detach 不靈 / PS encoding /
//      tar mangling / Start-Process redirect / rmrf retry / TS escape...)
//
// v3 改 Scoop pattern:
//   1. preflightCheck:無 pipeline running + hasUpdate
//   2. downloadAndStageVersion:
//      - download GitHub releases/latest tarball → 解壓到 `~/.vibe-pipeline/versions/v<tag>/`
//      - bun install 在 versions/v<tag>/ 同步跑完
//      - **完全不碰** current/ 跟 跑著的 backend cwd
//   3. writePending(tag) — `~/.vibe-pipeline/.pending` 純文字寫目標版本
//   4. backend setTimeout 500ms self-exit
//   5. user 跑 `vbpl server start`:vbpl cli 偵測 .pending → swapCurrentTo(tag) → clearPending → spawn
//   6. 新 backend 從 current/(= versions/v<tag>/)起,完全乾淨
//
// 為什麼把過去所有 Windows 雷砍光:
// - swap 發生時 current/ 內**沒人在跑** → 0% cwd EBUSY 風險
// - 不需要 helper script / detach / PowerShell — swap 是單一 fs.symlinkSync atomic call
// - 不需要 spawn 新 backend from updater — user 自己 `vbpl server start`,跟既有 CLI flow 一致
//
// 代價:user 多按一次 `vbpl server start`。對齊 CLAUDE.md 雷 #15(server lifecycle = user-driven)。
// PWA 端:UpdateTab 顯示「重啟以套用」訊息 + clipboard `vbpl server start` 指令。

import { join, basename } from "node:path";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, renameSync, readdirSync, statSync, existsSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { platform } from "node:os";
import { vibeHome } from "./paths";
import { getVersionStatus, fetchLatestRelease } from "./systemVersion";
import { versionStagingDir, versionsDir, writePending } from "./installLayout";
import * as orchestrator from "./runner/orchestrator";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

function vpRoot(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

export function updateLogPath(): string {
  return join(vpRoot(), "update.log");
}

function downloadDir(): string {
  return join(vpRoot(), "app.download.tmp");
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

async function fetchReleaseInfo(): Promise<ReleaseInfo> {
  const latest = await fetchLatestRelease();
  if (!latest) {
    throw new Error("無法取得 GitHub latest release(沒發過 release / 網路 / rate limit)");
  }
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

// Windows tar 解析:用 System32 native bsdtar(Win10 17063+),
// 避開 git-for-Windows usr/bin/tar.exe(MSYS bsdtar)做 path mangling 把 `C:\path`
// 變 `C\:\\path`。Bun.spawn 走 PATH 命中順序常抓到 git-for-Windows,顯式絕對路徑解決。
function winTarPath(): string {
  return join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe");
}

async function extractArchive(archivePath: string, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  const isWin = platform() === "win32";
  const tarBin = isWin ? winTarPath() : "tar";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    await runTool([tarBin, "-xzf", archivePath, "-C", outDir], outDir);
    return;
  }
  if (lower.endsWith(".zip")) {
    if (isWin) {
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
      await runTool([tarBin, "-xf", archivePath, "-C", outDir], outDir);
    }
    return;
  }
  throw new Error(`不支援的封存格式:${basename(archivePath)}`);
}

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

async function runBunInstall(cwd: string): Promise<void> {
  const proc = Bun.spawn(["bun", "install", "--silent"], {
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
  if (outBuf.trim()) log(`bun install stdout: ${outBuf.trim()}`);
  if (errBuf.trim()) log(`bun install stderr: ${errBuf.trim()}`);
  if (code !== 0) {
    throw new Error(`bun install failed exit=${code}`);
  }
}

export type StagedUpdate = {
  tag: string;
  stagingDir: string;
};

// Download + extract + bun install 到 `versions/<tag>.staging/`(不是直接 `versions/<tag>/`)。
// 理由:`versions/<tag>/` 可能正是 current → backend cwd,rmrf 會撞 EBUSY 自殺。
// staging 是獨立 dir,backend cwd 從不在裡面,可安全 rmrf + 寫。
// swap-on-start(installLayout.ts swapCurrentTo)才把 staging rename 成 final + 換 junction。
// 同 tag 重複 stage(retry / re-trigger)會 rmrf 既有 staging 重來。
export async function downloadAndStageVersion(): Promise<StagedUpdate> {
  ensureVpRoot();
  resetLog();
  log(`repo=${GITHUB_REPO}`);
  // 清上次殘留 download tmp(versions/ 保留)
  rmrf(downloadDir());
  mkdirSync(downloadDir(), { recursive: true });

  const rel = await fetchReleaseInfo();
  log(`tag=${rel.tag} url=${rel.downloadUrl} stripTop=${rel.needsStripTopLevel}`);

  const archivePath = join(downloadDir(), rel.filename);
  log(`download → ${archivePath}`);
  await downloadToFile(rel.downloadUrl, archivePath);

  // 解壓到 vp root 下的 tmp staging,resolveRoot 後再 rename 到 versions/<tag>.staging/
  // 兩階段是因為 tarball top-level dir 可能是 `<repo>-<sha>/` 要 strip
  const safeTag = rel.tag.replace(/[^a-zA-Z0-9._-]/g, "_");
  const tmpStaging = join(vpRoot(), `app.staging.${safeTag}`);
  rmrf(tmpStaging);
  log(`extract → ${tmpStaging}`);
  await extractArchive(archivePath, tmpStaging);
  const root = resolveRoot(tmpStaging, rel.needsStripTopLevel);
  log(`tmpRoot=${root}`);

  mkdirSync(versionsDir(), { recursive: true });
  const finalStaging = versionStagingDir(rel.tag);
  if (existsSync(finalStaging)) {
    log(`overwrite existing staging ${finalStaging}`);
    rmrf(finalStaging);
  }
  log(`rename ${root} → ${finalStaging}`);
  renameSync(root, finalStaging);
  rmrf(tmpStaging);
  rmrf(downloadDir());

  log(`bun install in ${finalStaging}`);
  await runBunInstall(finalStaging);
  log(`bun install ok`);

  log(`stage done tag=${rel.tag} stagingDir=${finalStaging}`);
  return { tag: rel.tag, stagingDir: finalStaging };
}

// re-export 給 route 用
export { writePending };

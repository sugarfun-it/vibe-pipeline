// /api/system/version 後端邏輯:
// - getCurrentVersion: 優先序 BUILD_VERSION env > package.json `version`(enduser install) > git describe(dev clone) > "dev-unknown"。
// - fetchLatestRelease: 抓 GitHub releases/latest,5min in-memory cache 防 rate-limit;
//   no network / no release / 404 → null。
// - getVersionStatus: 包成 endpoint shape。

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCapture } from "../io/childSpawn";

const GITHUB_REPO = process.env.VP_GITHUB_REPO ?? "sugarfun-it/vibe-pipeline";
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
// 暫時性失敗(網路 / 5xx / rate-limit / parse)只短 cache,避免 5 分鐘內 UI 一直紅字
// 「無法取得發行版資訊」。真的沒 release(404)是穩定狀態,照常 5 分 cache。
const RELEASE_NEGATIVE_TTL_MS = 30 * 1000;

export type LatestRelease = {
  tag: string;
  url: string;
  publishedAt: string;
};

export type VersionStatus = {
  current: string;
  latest: LatestRelease | null;
  isLatest: boolean;
  hasUpdate: boolean;
};

let cachedCurrent: string | null = null;

export async function getCurrentVersion(): Promise<string> {
  if (cachedCurrent) return cachedCurrent;
  const injected = process.env.BUILD_VERSION;
  if (injected && injected.trim().length > 0) {
    cachedCurrent = injected.trim();
    return cachedCurrent;
  }
  // installed mode 偵測:cwd 沒 .git/ → enduser tarball install → 讀 package.json
  // dev clone(.git/ 存在)直接走 git describe,確保 dev-<sha> 不被當成 release
  const isDevClone = existsSync(join(process.cwd(), ".git"));
  if (!isDevClone) {
    try {
      const pkg = (await Bun.file(join(process.cwd(), "package.json")).json()) as { version?: unknown };
      if (typeof pkg.version === "string") {
        const v = pkg.version.trim();
        if (v.length > 0 && v !== "0.0.0") {
          cachedCurrent = v.startsWith("v") ? v : `v${v}`;
          return cachedCurrent;
        }
      }
    } catch {
      // package.json 不存在 / parse 失敗,fallback 走 git(可能也失敗,回 dev-unknown)
    }
  }
  // dev clone fallback:跑 git describe / short SHA
  const describe = await runCapture(["git", "describe", "--tags", "--always", "--dirty"], {
    cwd: process.cwd(),
  });
  if (describe.ok && describe.out.trim().length > 0) {
    cachedCurrent = `dev-${describe.out.trim()}`;
    return cachedCurrent;
  }
  const sha = await runCapture(["git", "rev-parse", "--short", "HEAD"], { cwd: process.cwd() });
  if (sha.ok && sha.out.trim().length > 0) {
    cachedCurrent = `dev-${sha.out.trim()}`;
    return cachedCurrent;
  }
  cachedCurrent = "dev-unknown";
  return cachedCurrent;
}

type CacheEntry = {
  value: LatestRelease | null;
  fetchedAt: number;
  // transient=true(網路 / 5xx / rate-limit / parse 失敗)→ 用短 TTL,讓下次很快重抓。
  // false(成功取到值,或 404 確定沒 release)→ 用正常 5 分 TTL。
  transient: boolean;
};
let releaseCache: CacheEntry | null = null;
let inflight: Promise<LatestRelease | null> | null = null;

function cacheTtl(entry: CacheEntry): number {
  return entry.transient ? RELEASE_NEGATIVE_TTL_MS : RELEASE_CACHE_TTL_MS;
}

// force=true 跳過 cache 強制重抓(「檢查更新」按鈕用),避免暫時性 null 被 cache 卡住。
export async function fetchLatestRelease(opts?: { force?: boolean }): Promise<LatestRelease | null> {
  const now = Date.now();
  if (!opts?.force && releaseCache && now - releaseCache.fetchedAt < cacheTtl(releaseCache)) {
    return releaseCache.value;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const primary = await fetchLatestEndpoint();
      if (primary.kind === "ok") {
        releaseCache = { value: primary.value, fetchedAt: now, transient: false };
        return primary.value;
      }
      if (primary.kind === "absent") {
        // 404 = 確定沒 release(穩定狀態,正常 cache)
        releaseCache = { value: null, fetchedAt: now, transient: false };
        return null;
      }
      // primary 失敗(5xx / rate-limit / 網路 / parse)。GitHub 對 /releases/latest 偶發整個
      // 端點 504(其他端點正常),不該讓單一端點 flaky 擋掉更新檢查 → fallback 打 list 端點。
      const fallback = await fetchLatestFromList();
      if (fallback) {
        releaseCache = { value: fallback, fetchedAt: now, transient: false };
        return fallback;
      }
      releaseCache = { value: null, fetchedAt: now, transient: true };
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

type LatestEndpointResult =
  | { kind: "ok"; value: LatestRelease }
  | { kind: "absent" } // 404 — 確定沒 release
  | { kind: "fail" }; // 5xx / rate-limit / 網路 / parse — 可 fallback

async function fetchLatestEndpoint(): Promise<LatestEndpointResult> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "vibe-pipeline" },
    });
    if (res.status === 404) return { kind: "absent" };
    if (!res.ok) return { kind: "fail" };
    const json = (await res.json()) as { tag_name?: unknown; html_url?: unknown; published_at?: unknown };
    const value = toLatestRelease(json);
    return value ? { kind: "ok", value } : { kind: "fail" };
  } catch {
    return { kind: "fail" };
  }
}

// fallback:list 端點取第一個非 draft / 非 prerelease(GitHub list 預設 published 降冪)。
async function fetchLatestFromList(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "vibe-pipeline" },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{
      tag_name?: unknown;
      html_url?: unknown;
      published_at?: unknown;
      draft?: unknown;
      prerelease?: unknown;
    }>;
    if (!Array.isArray(arr)) return null;
    for (const r of arr) {
      if (r.draft === true || r.prerelease === true) continue;
      const value = toLatestRelease(r);
      if (value) return value;
    }
    return null;
  } catch {
    return null;
  }
}

function toLatestRelease(json: {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
}): LatestRelease | null {
  const tag = typeof json.tag_name === "string" ? json.tag_name : null;
  const url = typeof json.html_url === "string" ? json.html_url : null;
  const publishedAt = typeof json.published_at === "string" ? json.published_at : null;
  if (!tag || !url || !publishedAt) return null;
  return { tag, url, publishedAt };
}

// 對齊邏輯:current 可能是 "v0.1.0" / "0.1.0" / "abc1234" / "dev-xxx";
// latest.tag 通常 "v0.1.0"。dev 構建一律 hasUpdate=true(只要 latest 存在),
// 否則 normalize 後字串相等才算 isLatest。
function normalizeTag(s: string): string {
  return s.replace(/^v/i, "").trim().toLowerCase();
}

export async function getVersionStatus(opts?: { force?: boolean }): Promise<VersionStatus> {
  const [current, latest] = await Promise.all([getCurrentVersion(), fetchLatestRelease(opts)]);
  if (!latest) {
    return { current, latest: null, isLatest: false, hasUpdate: false };
  }
  const isDev = current.startsWith("dev-");
  const isLatest = !isDev && normalizeTag(current) === normalizeTag(latest.tag);
  const hasUpdate = !isLatest;
  return { current, latest, isLatest, hasUpdate };
}


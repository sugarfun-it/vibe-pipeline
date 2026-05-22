// /api/system/version 後端邏輯:
// - getCurrentVersion: 優先序 BUILD_VERSION env > package.json `version`(enduser install) > git describe(dev clone) > "dev-unknown"。
// - fetchLatestRelease: 抓 GitHub releases/latest,5min in-memory cache 防 rate-limit;
//   no network / no release / 404 → null。
// - getVersionStatus: 包成 endpoint shape。

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCapture } from "./spawn";

const GITHUB_REPO = process.env.VP_GITHUB_REPO ?? "eric14304/vibe-pipeline";
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;

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
};
let releaseCache: CacheEntry | null = null;
let inflight: Promise<LatestRelease | null> | null = null;

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const now = Date.now();
  if (releaseCache && now - releaseCache.fetchedAt < RELEASE_CACHE_TTL_MS) {
    return releaseCache.value;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "vibe-pipeline",
        },
      });
      if (!res.ok) {
        // 404 = no release;其他 5xx / rate limit 也回 null(best-effort)
        releaseCache = { value: null, fetchedAt: now };
        return null;
      }
      const json = (await res.json()) as {
        tag_name?: unknown;
        html_url?: unknown;
        published_at?: unknown;
      };
      const tag = typeof json.tag_name === "string" ? json.tag_name : null;
      const url = typeof json.html_url === "string" ? json.html_url : null;
      const publishedAt = typeof json.published_at === "string" ? json.published_at : null;
      if (!tag || !url || !publishedAt) {
        releaseCache = { value: null, fetchedAt: now };
        return null;
      }
      const value: LatestRelease = { tag, url, publishedAt };
      releaseCache = { value, fetchedAt: now };
      return value;
    } catch {
      releaseCache = { value: null, fetchedAt: now };
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// 對齊邏輯:current 可能是 "v0.1.0" / "0.1.0" / "abc1234" / "dev-xxx";
// latest.tag 通常 "v0.1.0"。dev 構建一律 hasUpdate=true(只要 latest 存在),
// 否則 normalize 後字串相等才算 isLatest。
function normalizeTag(s: string): string {
  return s.replace(/^v/i, "").trim().toLowerCase();
}

export async function getVersionStatus(): Promise<VersionStatus> {
  const [current, latest] = await Promise.all([getCurrentVersion(), fetchLatestRelease()]);
  if (!latest) {
    return { current, latest: null, isLatest: false, hasUpdate: false };
  }
  const isDev = current.startsWith("dev-");
  const isLatest = !isDev && normalizeTag(current) === normalizeTag(latest.tag);
  const hasUpdate = !isLatest;
  return { current, latest, isLatest, hasUpdate };
}


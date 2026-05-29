// Gateway bearer token 的 lazy 管理:
// - SSOT 在 `~/.vibe-pipeline/gateway-token`(純文字,只放 token 字串)
// - getToken: 讀檔,沒有回 null
// - ensureToken: 沒有就 POST `${PUSH_GATEWAY_URL}/tokens/auto-issue` 拿、存(posix chmod 0o600)、return
//
// backward compat:若 file 已存在(舊 user 從 PUSH_GATEWAY_TOKEN env 手動 migrate / 之前 auto-issue 過),
// 直接沿用,不重新 issue。也支援 process.env.PUSH_GATEWAY_TOKEN 當 override(若 file 沒有就 fallback 到 env,
// 不寫回 file,避免覆蓋 user 手動管理)。
//
// thread-safe:用記憶體 in-flight Promise 合併並發 ensure;寫檔走 atomic(.tmp → rename)。

import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { vibeHome } from "../../io/paths";
import { atomicWriteText } from "../../io/atomicWrite";
import { gatewayUrl } from "./gatewayConfig";

function dir(): string {
  return join(vibeHome(), ".vibe-pipeline");
}

function file(): string {
  return join(dir(), "gateway-token");
}

function envOverride(): string | null {
  const v = process.env.PUSH_GATEWAY_TOKEN?.trim();
  return v && v.length > 0 ? v : null;
}

async function readTokenFile(): Promise<string | null> {
  const p = file();
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, "utf-8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function writeTokenFile(token: string): Promise<void> {
  const d = dir();
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  // posix only;Windows NTFS chmod 沒效果(見 rules/remote-access.md),atomicWriteText 內已靜默忽略
  await atomicWriteText(file(), token, { chmod: 0o600 });
}

export async function getToken(): Promise<string | null> {
  const fromFile = await readTokenFile();
  if (fromFile) return fromFile;
  return envOverride();
}

let inflight: Promise<string> | null = null;

export async function ensureToken(): Promise<string> {
  const existing = await getToken();
  if (existing) return existing;

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      // double-check after lock acquire(可能其他 caller 剛寫完)
      const recheck = await getToken();
      if (recheck) return recheck;

      const url = gatewayUrl();
      const res = await fetch(`${url}/tokens/auto-issue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`gateway /tokens/auto-issue ${res.status}: ${text}`);
      }
      const json = (await res.json().catch(() => null)) as { token?: string } | null;
      const issued = typeof json?.token === "string" ? json.token.trim() : "";
      if (!issued) {
        throw new Error("gateway /tokens/auto-issue 回應缺 token 欄位");
      }
      await writeTokenFile(issued);
      return issued;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

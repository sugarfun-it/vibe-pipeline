import { useState } from "react";
import type { CommitRef } from "../../../../shared/types";
import { useTimeout } from "../../../hooks/useTimeout";
import { formatDateTime } from "../../../lib/format";

export function Commits({ commits }: { commits: CommitRef[] }) {
  // TD-COPY-003:用 {hash, nonce} 而不是只存 hash → 同一 hash 連點兩次也能 reset timer + 重播 SR live message
  const [copied, setCopied] = useState<{ hash: string; nonce: number } | null>(null);
  useTimeout(() => setCopied(null), copied ? 1500 : null, [copied]);
  // TD-COPY-004:SR live region 從 button 內抽出來,放在 container 外,避免 aria-hidden / aria-label 動態切換 race
  const liveMsg = copied ? `已複製完整 commit hash ${copied.hash} 到剪貼簿` : "";

  async function copy(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied({ hash, nonce: Date.now() });
    } catch {
      // 部分環境(non-https / older browsers)沒 clipboard API,fallback 暴力 select
      const ta = document.createElement("textarea");
      ta.value = hash;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied({ hash, nonce: Date.now() }); } catch {}
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="tdrw-commits">
      {/* 共用 visually-hidden live region,跟視覺 chip 解耦 — 視覺只負「我複製了哪個」,SR 負完整訊息 */}
      <span className="sr-only" role="status" aria-live="polite">{liveMsg}</span>
      {commits.map((c) => {
        const isCopied = copied?.hash === c.hash;
        const shortHash = c.hash.slice(0, 7);
        return (
          <div key={c.hash} className="tdrw-commit">
            <button type="button"
              className={"mono tdrw-commit-hash tdrw-commit-hash-btn" + (isCopied ? " is-copied" : "")}
              title={isCopied ? `已複製完整 commit hash:${c.hash}` : `點擊複製完整 commit hash:${c.hash}`}
              aria-label={`複製完整 commit hash ${c.hash}`}
              onClick={() => copy(c.hash)}
            >
              {shortHash}
              {/* TD-COPY-001:chip 改錨在 hash button 上方,不再蓋住 hash 文字。
                  chip 純視覺(aria-hidden),SR 訊息走上面的 .sr-only live region。 */}
              <span
                className="tdrw-commit-copied"
                aria-hidden="true"
                data-visible={isCopied || undefined}
                // key on nonce 強制 re-mount → CSS transition / animation 從頭播
                key={isCopied ? copied!.nonce : "idle"}
              >
                已複製完整 hash
              </span>
            </button>
            <span className="tdrw-commit-subject">{c.subject}</span>
            <span className="mono tdrw-commit-ts">{formatDateTime(c.ts, "short")}</span>
          </div>
        );
      })}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { getSystemVersion, type VersionStatus } from "../../api/system";

const POSIX_CMD = "curl -fsSL https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.sh | sh";
const WIN_CMD = "irm https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.ps1 | iex";
const CLI_CMD = "vbpl update";

type CmdKey = "posix" | "windows" | "cli";

export function UpdateTab({ onActionError: _onActionError }: { onActionError?: (m: string) => void }) {
  const [version, setVersion] = useState<VersionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<CmdKey | null>(null);

  const fetchVersion = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const v = await getSystemVersion();
      setVersion(v);
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "讀取版本失敗";
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchVersion();
  }, [fetchVersion]);

  const copyCmd = useCallback(async (key: CmdKey, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(key);
      setTimeout(() => setCopied((curr) => (curr === key ? null : curr)), 2000);
    } catch {
      // clipboard 失敗(權限 / http) → 不擋,user 自己選 + copy
    }
  }, []);

  return (
    <div className="task-group task-group--primary">
      <div className="settings-section-title">應用版本</div>

      {loading && !version && <div className="settings-subhint">載入中…</div>}
      {loadError && !version && <div className="mono settings-error">{loadError}</div>}

      {version && (
        <div className="update-tab-body">
          <div className="mono update-version-line">
            {version.hasUpdate && version.latest ? (
              <>
                <span className="update-version-current">{version.current}</span>
                <span className="update-version-arrow">→</span>
                <span className="update-version-latest">{version.latest.tag}</span>
                <a
                  href={version.latest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="update-release-link"
                >
                  release notes ↗
                </a>
              </>
            ) : version.latest ? (
              <>
                <span>{version.current}</span>
                <span className="update-version-status">(已是最新)</span>
              </>
            ) : (
              <>
                <span>{version.current}</span>
                <span className="update-version-status">(無法取得 release 資訊)</span>
              </>
            )}
          </div>

          <div className="push-action-row">
            <button
              type="button"
              className="btn"
              onClick={() => void fetchVersion()}
              disabled={loading}
            >
              {loading ? "檢查中…" : "檢查更新"}
            </button>
          </div>

          {version.hasUpdate && version.latest && (
            <div className="update-tab-body">
              <div className="settings-subhint">
                在 terminal 跑以下任一指令套用更新(會停 backend → 解壓 → 重啟):
              </div>

              <UpdateCmdRow
                label="vbpl CLI(任一平台)"
                cmd={CLI_CMD}
                copied={copied === "cli"}
                onCopy={() => void copyCmd("cli", CLI_CMD)}
              />
              <UpdateCmdRow
                label="macOS / Linux"
                cmd={POSIX_CMD}
                copied={copied === "posix"}
                onCopy={() => void copyCmd("posix", POSIX_CMD)}
              />
              <UpdateCmdRow
                label="Windows PowerShell"
                cmd={WIN_CMD}
                copied={copied === "windows"}
                onCopy={() => void copyCmd("windows", WIN_CMD)}
              />

              <div className="settings-subhint">
                跑完後切回本頁,新 UI bundle 偵測到會跳「套用更新」banner 提示 reload。
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UpdateCmdRow({
  label,
  cmd,
  copied,
  onCopy,
}: {
  label: string;
  cmd: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="update-cmd-row">
      <div className="settings-subhint">{label}</div>
      <div className="update-cmd-line">
        <code className="mono update-cmd-code">{cmd}</code>
        <button type="button" className="btn" onClick={onCopy}>
          {copied ? "已複製" : "複製"}
        </button>
      </div>
    </div>
  );
}

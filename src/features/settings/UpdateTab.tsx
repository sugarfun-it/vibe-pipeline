import { useCallback, useEffect, useRef, useState } from "react";
import {
  getHealth,
  getSystemVersion,
  triggerSystemUpdate,
  type VersionStatus,
} from "../../api/system";
import { ApiError } from "../../api/_client";

type UpdatingPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "polling"; consecutiveOk: number; afterDown: boolean }
  | { kind: "done"; newTag: string | null }
  | { kind: "error"; reason: string };

const HEALTH_POLL_INTERVAL_MS = 2000;
const HEALTH_POLL_TIMEOUT_MS = 180_000;

export function UpdateTab({ onActionError }: { onActionError?: (m: string) => void }) {
  const [version, setVersion] = useState<VersionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<UpdatingPhase>({ kind: "idle" });
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);

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

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const startHealthPoll = useCallback(() => {
    startTimeRef.current = Date.now();
    setPhase({ kind: "polling", consecutiveOk: 0, afterDown: false });

    const tick = async () => {
      if (Date.now() - startTimeRef.current > HEALTH_POLL_TIMEOUT_MS) {
        setPhase({ kind: "error", reason: "等待 backend 回來逾時(180s),請手動 reload 頁面確認。" });
        return;
      }
      const ctrl = new AbortController();
      pollAbortRef.current = ctrl;
      let okThisTick = false;
      try {
        await getHealth(ctrl.signal);
        okThisTick = true;
      } catch {
        okThisTick = false;
      }
      let shouldFinalize = false;
      setPhase((prev) => {
        if (prev.kind !== "polling") return prev;
        if (!okThisTick) {
          return { ...prev, consecutiveOk: 0, afterDown: true };
        }
        if (!prev.afterDown) {
          return prev;
        }
        const next = prev.consecutiveOk + 1;
        if (next >= 2) {
          shouldFinalize = true;
          return prev;
        }
        return { ...prev, consecutiveOk: next };
      });
      if (shouldFinalize) {
        try {
          const v = await getSystemVersion();
          setVersion(v);
          setPhase({ kind: "done", newTag: v.current });
        } catch {
          setPhase({ kind: "done", newTag: null });
        }
        return;
      }
      pollTimerRef.current = setTimeout(() => {
        void tick();
      }, HEALTH_POLL_INTERVAL_MS);
    };

    void tick();
  }, []);

  const onApply = useCallback(async () => {
    setPhase({ kind: "starting" });
    try {
      await triggerSystemUpdate();
      startHealthPoll();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error && e.message
            ? e.message
            : "觸發更新失敗";
      setPhase({ kind: "error", reason: msg });
      onActionError?.(msg);
    }
  }, [onActionError, startHealthPoll]);

  const isUpdating = phase.kind === "starting" || phase.kind === "polling";
  const applyDisabled = !version || !version.hasUpdate || isUpdating;

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
                  查看 release notes ↗
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
              disabled={loading || isUpdating}
            >
              {loading ? "檢查中…" : "檢查更新"}
            </button>
            <button
              type="button"
              className={applyDisabled ? "btn" : "btn-primary"}
              onClick={() => void onApply()}
              disabled={applyDisabled}
            >
              {isUpdating ? "更新中…" : "套用更新"}
            </button>
          </div>

          {phase.kind === "polling" && (
            <div className="update-progress-hint">
              backend 重啟中,預期 30–60 秒。{phase.afterDown ? "已重新連線,確認中…" : "等待 backend 下線…"}
            </div>
          )}

          {phase.kind === "done" && (
            <div className="mono update-success">
              ✓ backend 已更新{phase.newTag ? `到 ${phase.newTag}` : ""}。Frontend 新版 banner 即將出現,點該 banner 套用。
            </div>
          )}

          {phase.kind === "error" && <div className="mono settings-error">{phase.reason}</div>}
        </div>
      )}
    </div>
  );
}

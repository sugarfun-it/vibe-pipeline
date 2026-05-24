import { useCallback, useEffect, useRef, useState } from "react";
import { getSystemVersion, triggerSystemUpdate, getHealth, type VersionStatus } from "../../api/system";
import { ApiError } from "../../api/_client";
import { ArrowRightIcon, CheckIconSm, ExternalLinkIcon, SpinnerIcon } from "../../ui/icons";
import { useToast } from "../../ui/Toast";
import { useAsyncAction } from "../../hooks/useAsyncAction";

type UpdatingPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "polling"; afterDown: boolean }
  | { kind: "done"; newTag: string | null }
  | { kind: "error"; reason: string };

const HEALTH_POLL_INTERVAL_MS = 2000;
const HEALTH_POLL_TIMEOUT_MS = 180_000;

function formatLastChecked(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function UpdateTab() {
  const { toast } = useToast();
  const [version, setVersion] = useState<VersionStatus | null>(null);
  const [phase, setPhase] = useState<UpdatingPhase>({ kind: "idle" });
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);

  const [fetchVersion, { pending: fetching }] = useAsyncAction(async () => {
    try {
      const v = await getSystemVersion();
      setVersion(v);
      setLastCheckedAt(Date.now());
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "讀取版本失敗";
      toast(msg, { variant: "danger" });
      throw e;
    }
  });
  const loading = fetching;

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
    setPhase({ kind: "polling", afterDown: false });

    const tick = async () => {
      if (Date.now() - startTimeRef.current > HEALTH_POLL_TIMEOUT_MS) {
        const reason = "等待 backend 回來逾時（3 min）。請手動 reload 頁面。";
        setPhase({ kind: "error", reason });
        toast("更新未完成，請查看更新面板", { variant: "danger" });
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
          // backend 還沒回來 → 進 afterDown 狀態(預期會發生:backend exit + install 跑)
          return { ...prev, afterDown: true };
        }
        // backend 回來了
        if (prev.afterDown) {
          shouldFinalize = true;
        }
        return prev;
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
  }, [toast]);

  const onApply = useCallback(async () => {
    setPhase({ kind: "starting" });
    try {
      await triggerSystemUpdate();
      startHealthPoll();
    } catch (e) {
      const reason =
        e instanceof ApiError
          ? e.message
          : e instanceof Error && e.message
            ? e.message
            : "觸發更新失敗";
      setPhase({ kind: "error", reason });
      toast("更新未完成，請查看更新面板", { variant: "danger" });
    }
  }, [toast, startHealthPoll]);

  const isUpdating = phase.kind === "starting" || phase.kind === "polling";
  const isError = phase.kind === "error";
  const isDevBuild = !!version && /^dev-|-dirty$/.test(version.current);

  return (
    <div className="task-group task-group--primary">
      <div className="settings-section-title">應用版本</div>

      {loading && !version && <div className="settings-subhint">載入中…</div>}

      {version && (
        <div className="update-tab-body" aria-busy={isUpdating || undefined}>
          {/* 狀態摘要 — 不是資料表 */}
          <div className="update-summary">
            <div className="update-summary-headline">
              <span className="mono update-version-current" title={version.current}>
                {version.current}
              </span>
              {!version.hasUpdate && !isDevBuild && version.latest && (
                <span className="vp-chip vp-chip--success">已是最新</span>
              )}
              {version.hasUpdate && !isDevBuild && (
                <span className="vp-chip vp-chip--info">有新 release</span>
              )}
            </div>
            {version.latest ? (
              <div className="update-summary-sub">
                最新 release{" "}
                <span
                  className={
                    "mono update-version-latest" +
                    (version.hasUpdate ? " update-version-latest--accent" : "")
                  }
                >
                  {version.latest.tag}
                </span>
                <span className="update-summary-sep" aria-hidden>·</span>
                <a
                  href={version.latest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="update-release-link"
                  aria-label="開啟 release notes（新視窗）"
                >
                  release notes <ExternalLinkIcon aria-hidden />
                </a>
              </div>
            ) : (
              <div className="update-summary-sub update-summary-sub--error">
                無法取得 release 資訊
              </div>
            )}
          </div>

          {isDevBuild && (
            <div className="update-dev-hint" role="note">
              偵測到開發版（dev / dirty build），通常已含未發佈變更。「立即更新」會切回最新正式 release。
            </div>
          )}

          <div className="push-action-row update-action-row">
            <button
              type="button"
              className="btn"
              onClick={() => void fetchVersion()}
              disabled={loading || isUpdating}
            >
              {loading ? "檢查中…" : "檢查更新"}
            </button>
            {version.hasUpdate && !isDevBuild && !isError && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onApply()}
                disabled={isUpdating}
              >
                {isUpdating ? "更新中…" : "立即更新"}
              </button>
            )}
            {isDevBuild && !isError && (
              <button
                type="button"
                className="btn"
                onClick={() => void onApply()}
                disabled={isUpdating}
                title="切回最新正式 release（會覆蓋目前 dev / dirty build）"
              >
                {isUpdating ? "更新中…" : "切回正式 release"}
              </button>
            )}
          </div>

          <div className="update-last-checked">
            上次檢查：{formatLastChecked(lastCheckedAt)}
          </div>

          {phase.kind === "polling" && (
            <div className="update-progress" role="status" aria-live="polite">
              <SpinnerIcon className="update-progress-spinner" aria-hidden />
              <div className="update-progress-text">
                <div className="update-progress-title">backend 重啟中，通常需 30-60 秒</div>
                <div className="update-progress-sub">
                  {phase.afterDown ? "已重新連線，正在確認版本…" : "等待 backend 下線…"}
                </div>
              </div>
            </div>
          )}

          {phase.kind === "done" && (
            <div className="update-success" role="status" aria-live="polite">
              <CheckIconSm aria-hidden />
              <div className="update-success-text">
                <div className="update-success-title">
                  已更新{phase.newTag ? (
                    <>
                      到 <span className="mono update-success-tag">{phase.newTag}</span>
                    </>
                  ) : ""}
                </div>
                <div className="update-success-sub">重新整理後會載入新版。</div>
              </div>
            </div>
          )}

          {phase.kind === "error" && (
            <div className="update-error" role="alert" aria-live="assertive">
              <div className="update-error-title">更新未完成</div>
              <div className="update-error-reason">{phase.reason}</div>
              <div className="update-error-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setPhase({ kind: "idle" });
                    void fetchVersion();
                  }}
                >
                  重新檢查
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.location.reload()}
                >
                  重新整理頁面
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

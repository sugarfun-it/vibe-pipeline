import { useCallback, useEffect, useRef, useState } from "react";
import { getSystemVersion, triggerSystemUpdate, type VersionStatus } from "../../api/system";
import { ApiError } from "../../api/_client";
import { ArrowRightIcon, CheckIconSm, ExternalLinkIcon, SpinnerIcon } from "../../ui/icons";
import { useToast } from "../../ui/Toast";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { formatLastChecked } from "../../lib/format";

type UpdatingPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "polling"; afterDown: boolean; lastTickOk: boolean }
  | { kind: "done"; newTag: string | null }
  | { kind: "error"; reason: string };

const HEALTH_POLL_INTERVAL_MS = 2000;
const HEALTH_POLL_TIMEOUT_MS = 180_000;

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

  // poll /api/system/version(兼當 health probe + 版本變化偵測)。
  // 比舊版純 /api/health 多一個 fallback signal:即使 PWA 從沒抓到 down(install 太快、
  // setTimeout 對齊不巧),只要看到 current 跟 install 前不同 → 視為 install 成功,finalize。
  // 否則卡死在「等待 backend 下線」(舊 bug,polling 假設一定會看到 down→up transition)。
  const startHealthPoll = useCallback((initialVersion: string) => {
    startTimeRef.current = Date.now();
    let localAfterDown = false;
    setPhase({ kind: "polling", afterDown: false, lastTickOk: true });

    const tick = async () => {
      if (Date.now() - startTimeRef.current > HEALTH_POLL_TIMEOUT_MS) {
        const reason = "系統更新後超過 3 分鐘仍未恢復連線。請重新整理頁面，或稍後再檢查。";
        setPhase({ kind: "error", reason });
        return;
      }
      const ctrl = new AbortController();
      pollAbortRef.current = ctrl;
      let v: VersionStatus | null = null;
      try {
        v = await getSystemVersion(ctrl.signal);
        setVersion(v);
      } catch {
        v = null;
      }
      if (!v) {
        localAfterDown = true;
        setPhase((prev) => (prev.kind === "polling" ? { ...prev, afterDown: true, lastTickOk: false } : prev));
      } else if (v.current !== initialVersion) {
        // 版本變了 = install 真的把新 tarball swap 進去了,不管中間有沒有看到 down,直接 finalize
        setPhase({ kind: "done", newTag: v.current });
        return;
      } else if (localAfterDown) {
        // 版本沒變但中間看到過 down(同版重裝 / install 失敗 fallback),仍視為流程結束
        setPhase({ kind: "done", newTag: v.current });
        return;
      } else {
        setPhase((prev) => (prev.kind === "polling" ? { ...prev, lastTickOk: true } : prev));
      }
      pollTimerRef.current = setTimeout(() => {
        void tick();
      }, HEALTH_POLL_INTERVAL_MS);
    };

    void tick();
  }, []);

  const onApply = useCallback(async () => {
    const initial = version?.current ?? "";
    setPhase({ kind: "starting" });
    try {
      await triggerSystemUpdate();
      startHealthPoll(initial);
    } catch (e) {
      const reason =
        e instanceof ApiError
          ? e.message
          : e instanceof Error && e.message
            ? e.message
            : "觸發更新失敗";
      setPhase({ kind: "error", reason });
      // 同 timeout：錯誤已 in-panel,不重複 toast。
    }
  }, [startHealthPoll, version?.current]);

  const isUpdating = phase.kind === "starting" || phase.kind === "polling";
  const isError = phase.kind === "error";
  const isDevBuild = !!version && /^dev-|-dirty$/.test(version.current);

  return (
    <div className="task-group task-group--primary">
      <div className="settings-section-title">應用版本</div>

      {loading && !version && <div className="settings-subhint">載入中…</div>}

      {version && (
        <div className="update-tab-body" aria-busy={isUpdating || undefined}>
          {/* 狀態摘要 — 不是資料表;非 live region(避免與下方 phase block 的 status 重複播報) */}
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
                最新發行版{" "}
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
                  aria-label="開啟發行說明（新視窗）"
                >
                  發行說明 <ExternalLinkIcon aria-hidden />
                </a>
              </div>
            ) : (
              <div className="update-summary-sub update-summary-sub--error">
                無法取得發行版資訊
              </div>
            )}
          </div>

          {isDevBuild && (
            <div className="update-dev-hint" role="note">
              偵測到開發版（dev / dirty build），通常已含未發佈變更。「立即更新」會切回最新正式 release。
            </div>
          )}

          <div className="push-action-row update-action-row">
            {!isError && (
              <button
                type="button"
                className="btn"
                onClick={() => void fetchVersion()}
                disabled={loading || isUpdating}
              >
                {loading ? "檢查中…" : "檢查更新"}
              </button>
            )}
            {version.hasUpdate && !isDevBuild && !isError && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onApply()}
                disabled={isUpdating}
              >
                {phase.kind === "starting"
                  ? "啟動中…"
                  : phase.kind === "polling"
                    ? "更新中…"
                    : "立即更新"}
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
                {phase.kind === "starting"
                  ? "啟動中…"
                  : phase.kind === "polling"
                    ? "更新中…"
                    : "切回正式 release"}
              </button>
            )}
          </div>

          <div className="update-last-checked">
            上次檢查：{formatLastChecked(lastCheckedAt)}
          </div>

          {phase.kind === "starting" && (
            <div className="update-progress" role="status" aria-live="polite">
              <SpinnerIcon className="update-progress-spinner" aria-hidden />
              <div className="update-progress-text">
                <div className="update-progress-title">啟動更新中…</div>
                <div className="update-progress-sub">
                  已送出更新指令，等待 backend 接手。
                </div>
              </div>
            </div>
          )}

          {phase.kind === "polling" && (
            <div className="update-progress" role="status" aria-live="polite">
              <SpinnerIcon className="update-progress-spinner" aria-hidden />
              <div className="update-progress-text">
                <div className="update-progress-title">backend 重啟中，通常需 30-60 秒</div>
                <div className="update-progress-sub">
                  {!phase.afterDown
                    ? "等待 backend 下線…（更新流程預期會短暫離線）"
                    : !phase.lastTickOk
                      ? "backend 暫時離線中，持續確認回應…"
                      : "已重新連線，正在確認版本…"}
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
                  ) : ""}。新版前端準備好時上方會跳套用更新提示。
                </div>
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
                  className="btn btn-primary"
                  onClick={() => window.location.reload()}
                >
                  重新整理頁面
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setPhase({ kind: "idle" });
                    void fetchVersion();
                  }}
                >
                  重新檢查連線
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import * as api from "../../api/projects";
import * as userConfigApi from "../../api/userConfig";
import { SecurityTab } from "../auth/SecurityTab";
import { UpdateTab } from "./UpdateTab";
import { useAuthStatus } from "../auth/useAuthStatus";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import {
  getPermission,
  getStoredToken,
  isFcmSupported,
  requestAndRegisterToken,
  unregisterToken as unregisterFcm,
} from "../../lib/fcm";
import "./SettingsPopover.css";
import {
  PROVIDERS,
  TASK_CLASSES,
  TASK_CLASS_HINTS,
  TASK_CLASS_LABELS,
  defaultEffortForProvider,
  defaultModelForProvider,
  effortsForProvider,
  isValidEffort,
  isValidModel,
  modelsForProvider,
  type Effort,
  type ModelName,
  type Provider,
  type PushEventKey,
  type TaskClass,
  type UserConfig,
} from "../../../shared/types";

const MIN = 1;
const MAX = 8;
const AUTOSAVE_DELAY_MS = 400;
const SAVED_VISIBLE_MS = 3000;

type TaskModelPatch = { provider?: Provider; model?: ModelName; effort?: Effort };
type ProjectField = "max_parallel" | "default_base_branch" | "cost_limit_usd" | "auto_merge";
type TaskField = "provider" | "model" | "effort";
type AutosaveKey = `project:${ProjectField}` | `task:${TaskClass}:${TaskField}`;
type ProjectConfirmedValues = {
  max_parallel: number;
  default_base_branch: string;
  cost_limit_usd: string;
  auto_merge: boolean;
};
type TaskConfirmedValue = Provider | ModelName | Effort;
type TaskConfirmedValues = Partial<Record<`task:${TaskClass}:${TaskField}`, TaskConfirmedValue>>;

const PUSH_EVENT_LABELS: Array<{ key: PushEventKey; label: string }> = [
  { key: "ticket_done", label: "Ticket 完成" },
  { key: "ticket_failed", label: "Ticket 失敗" },
  { key: "pipeline_paused", label: "Pipeline 暫停需回應" },
  { key: "pipeline_ready", label: "Pipeline 跑完" },
  { key: "auto_merge_conflict", label: "AI 接手解衝突" },
];

// Select 樣式 + 寬度都搬到 SettingsPopover.css(.task-row-selects > select 與 --task-w-* CSS vars)

function TaskModelRow({
  label,
  hint,
  provider,
  model,
  effort,
  disabled,
  showProvider = false,
  onChange,
}: {
  label: string;
  hint?: string;
  provider: Provider;
  model: ModelName;
  effort: Effort;
  disabled?: boolean;
  showProvider?: boolean;
  onChange: (patch: { provider?: Provider; model?: ModelName; effort?: Effort }) => void;
}) {
  // layout(2026-05-13 update,RWD 完整搬 CSS):
  //   row1: label(左)+ selects(右,desktop grid / mobile 整列)
  //   row2: hint(獨立一行,full width)
  // 樣式全走 SettingsPopover.css 的 .task-row-* class,desktop / mobile breakpoint 都在 CSS 內。
  return (
    <div className="task-row">
      <div className="task-row-head">
        <span className="task-row-label">{label}</span>
        <div className="task-row-selects">
          {showProvider ? (
            <select
              value={provider}
              disabled={disabled}
              onChange={(e) => onChange({ provider: e.target.value as Provider })}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : (
            <span className="task-row-placeholder" />
          )}
          <select
            value={model}
            disabled={disabled}
            onChange={(e) => onChange({ model: e.target.value as ModelName })}
          >
            {modelsForProvider(provider).map((m) => (
              <option key={m} value={m}>
                {m.replace(/^claude-/, "")}
              </option>
            ))}
          </select>
          <select
            value={effort}
            disabled={disabled}
            onChange={(e) => onChange({ effort: e.target.value as Effort })}
          >
            {effortsForProvider(provider).map((eff) => (
              <option key={eff} value={eff}>
                {eff}
              </option>
            ))}
          </select>
        </div>
      </div>
      {hint && <div className="task-row-hint">{hint}</div>}
    </div>
  );
}

function PushNotificationsSection({
  userCfg,
  pushSaving,
  onTogglePushEvent,
  onActionError,
}: {
  userCfg: UserConfig | null;
  pushSaving: Partial<Record<PushEventKey, boolean>>;
  onTogglePushEvent: (key: PushEventKey, enabled: boolean) => void;
  onActionError?: (message: string) => void;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(getPermission());
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isFcmSupported().then((ok) => {
      if (!cancelled) setSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function refreshPermission() {
    setPermission(getPermission());
    setToken(getStoredToken());
  }

  async function enable() {
    setLoading(true);
    setLastError(null);
    try {
      await requestAndRegisterToken();
      refreshPermission();
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "啟用通知失敗";
      setLastError(message);
      onActionError?.(message);
      refreshPermission();
    } finally {
      setLoading(false);
    }
  }

  async function disable() {
    setLoading(true);
    setLastError(null);
    try {
      await unregisterFcm();
      refreshPermission();
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "停用通知失敗";
      setLastError(message);
      onActionError?.(message);
    } finally {
      setLoading(false);
    }
  }

  const enabled = permission === "granted" && !!token;
  const disabled = supported === false || permission === "denied" || loading || supported === null;
  const hint = supported === false
    ? "此瀏覽器不支援 Web Push。"
    : permission === "denied"
      ? "已被瀏覽器封鎖,請至網址列設定重新允許後再回此頁啟用。"
      : loading
        ? "處理中…"
        : null;

  return (
    <div>
      <div className="push-toggle-row">
        <label
          className={"toggle-pill mono" + (enabled ? " is-on" : "")}
          style={{ opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.checked) void enable();
              else void disable();
            }}
          />
          <span className="toggle-pill-track" aria-hidden>
            <span className="toggle-pill-thumb" />
          </span>
          {enabled ? "推播通知" : "啟用推播通知"}
        </label>
        {hint && <span className="push-hint" style={{ margin: 0 }}>{hint}</span>}
      </div>
      {enabled && (
        <div className="settings-popover-task-grid" aria-label="推播事件" style={{ marginTop: 14, marginLeft: 12, paddingLeft: 12, borderLeft: "2px solid var(--line)", width: "fit-content", alignItems: "stretch" }}>
          {PUSH_EVENT_LABELS.map((item) => {
            const checked = userCfg?.pushEvents[item.key] ?? true;
            return (
              <label
                key={item.key}
                className={"toggle-pill mono" + (checked ? " is-on" : "")}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!userCfg || !!pushSaving[item.key]}
                  onChange={(e) => onTogglePushEvent(item.key, e.target.checked)}
                />
                <span className="toggle-pill-track" aria-hidden>
                  <span className="toggle-pill-thumb" />
                </span>
                {item.label}
              </label>
            );
          })}
        </div>
      )}

      {lastError && (
        <div className="mono push-error">
          {lastError}
        </div>
      )}
    </div>
  );
}

function InstallAppSection({ onActionError }: { onActionError?: (message: string) => void }) {
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "unavailable") {
        onActionError?.("此瀏覽器無法觸發安裝,請改用瀏覽器選單的「安裝 App」");
      }
    } finally {
      setBusy(false);
    }
  }

  // button 只在「真能 prompt」(canInstall + 未 install)才顯,避免 disabled button 誤導 user 點不動以為壞。
  // 已 install / 不能 prompt 都改純文字提示。
  return (
    <>
      <div className="settings-section-title">安裝為 App</div>
      {canInstall && !installed && (
        <div className="push-action-row">
          <button type="button" className="btn" disabled={busy} onClick={() => void onClick()}>
            {busy ? "處理中…" : "安裝 App"}
          </button>
        </div>
      )}
      <div className="push-hint" style={{ margin: 0 }}>
        {installed
          ? "已安裝,直接從 App 圖示開啟即可。"
          : canInstall
            ? "安裝後可全螢幕、推播更穩。"
            : "沒安裝鈕?可能已裝、或瀏覽器不支援。Chrome / Edge 用網址列「⊕」;iOS Safari 走「分享 → 加入主畫面」。"}
      </div>
    </>
  );
}

// Project-level Settings popover。露 max_parallel / default_base_branch / cost_limit_usd。
// (merge_strategy 已鎖 'merge',不再露,因為 squash/ff-only 跟 auto-rebase + sync chip 不相容)
export function SettingsPopover({
  hash,
  open,
  onClose,
  onSaved,
  onActionError,
  anchorRef,
}: {
  hash: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (cfg: api.ProjectConfig) => void;
  onActionError?: (message: string) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [cfg, setCfg] = useState<api.ProjectConfig | null>(null);
  const [draftMaxParallel, setDraftMaxParallel] = useState<number>(2);
  const [draftBaseBranch, setDraftBaseBranch] = useState<string>("");
  const [draftCostLimit, setDraftCostLimit] = useState<string>("0");
  const [draftAutoMerge, setDraftAutoMerge] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVisible, setSavedVisible] = useState(false);
  const [savedFading, setSavedFading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<Partial<Record<AutosaveKey, ReturnType<typeof setTimeout>>>>({});
  const controllersRef = useRef<Partial<Record<AutosaveKey, AbortController>>>({});
  const seqRef = useRef<Partial<Record<AutosaveKey, number>>>({});
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedProjectCfgRef = useRef<api.ProjectConfig | null>(null);
  const savedUserCfgRef = useRef<UserConfig | null>(null);
  const confirmedProjectValuesRef = useRef<ProjectConfirmedValues | null>(null);
  const confirmedTaskValuesRef = useRef<TaskConfirmedValues>({});
  // User-level config(跨 project)— 跟上面的 project-level 是不同層,獨立 PUT
  const [userCfg, setUserCfg] = useState<UserConfig | null>(null);
  const [userCfgError, setUserCfgError] = useState<string | null>(null);
  const [pushSaving, setPushSaving] = useState<Partial<Record<PushEventKey, boolean>>>({});
  const { status: authStatus } = useAuthStatus();
  // tab 切換 — 取代之前 stacked sections,避免 popover 越來越長
  type TabKey = "project" | "ai" | "notifications" | "update" | "security";
  const [activeTab, setActiveTab] = useState<TabKey>("project");

  function isAbortError(e: unknown): boolean {
    return e instanceof Error && e.name === "AbortError";
  }

  function toastSaveError(e: unknown) {
    if (isAbortError(e)) return;
    const message = e instanceof Error && e.message ? e.message : "儲存失敗，請重試";
    onActionError?.(message);
  }

  function showSaved() {
    setSavedVisible(true);
    setSavedFading(false);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedFading(true), SAVED_VISIBLE_MS);
  }

  function onSavedTransitionEnd(e: React.TransitionEvent<HTMLSpanElement>) {
    if (e.propertyName !== "opacity" || !savedFading) return;
    setSavedVisible(false);
    setSavedFading(false);
  }

  function setConfirmedProjectValues(c: api.ProjectConfig) {
    confirmedProjectValuesRef.current = {
      max_parallel: c.defaults.max_parallel,
      default_base_branch: c.defaults.base_branch ?? "",
      cost_limit_usd: String(c.defaults.cost_limit_usd ?? 0),
      auto_merge: !!c.defaults.auto_merge,
    };
  }

  function updateConfirmedProjectValue(field: ProjectField, c: api.ProjectConfig) {
    const current =
      confirmedProjectValuesRef.current ?? {
        max_parallel: c.defaults.max_parallel,
        default_base_branch: c.defaults.base_branch ?? "",
        cost_limit_usd: String(c.defaults.cost_limit_usd ?? 0),
        auto_merge: !!c.defaults.auto_merge,
      };
    confirmedProjectValuesRef.current = {
      ...current,
      [field]:
        field === "max_parallel"
          ? c.defaults.max_parallel
          : field === "default_base_branch"
            ? (c.defaults.base_branch ?? "")
            : field === "cost_limit_usd"
              ? String(c.defaults.cost_limit_usd ?? 0)
              : !!c.defaults.auto_merge,
    };
  }

  function setConfirmedTaskValues(c: UserConfig) {
    const next: TaskConfirmedValues = {};
    for (const tc of TASK_CLASSES) {
      next[`task:${tc}:provider`] = c.defaults[tc].provider;
      next[`task:${tc}:model`] = c.defaults[tc].model;
      next[`task:${tc}:effort`] = c.defaults[tc].effort;
    }
    confirmedTaskValuesRef.current = next;
  }

  function applyConfirmedTaskValue(
    task: UserConfig["defaults"][TaskClass],
    field: TaskField,
    value: TaskConfirmedValue
  ): UserConfig["defaults"][TaskClass] {
    if (field === "provider") return { ...task, provider: value as Provider };
    if (field === "model") return { ...task, model: value as ModelName };
    return { ...task, effort: value as Effort };
  }

  function scheduleAutosave(
    key: AutosaveKey,
    run: (signal: AbortSignal, seq: number) => Promise<void>,
    rollback: (e: unknown) => void
  ) {
    const seq = (seqRef.current[key] ?? 0) + 1;
    seqRef.current[key] = seq;
    const existingTimer = timersRef.current[key];
    if (existingTimer) clearTimeout(existingTimer);
    timersRef.current[key] = setTimeout(() => {
      controllersRef.current[key]?.abort();
      const controller = new AbortController();
      controllersRef.current[key] = controller;
      run(controller.signal, seq)
        .catch((e: unknown) => {
          if (seqRef.current[key] !== seq || isAbortError(e)) return;
          rollback(e);
        })
        .finally(() => {
          if (controllersRef.current[key] === controller) delete controllersRef.current[key];
        });
    }, AUTOSAVE_DELAY_MS);
  }

  function mergeProjectSaved(field: ProjectField, next: api.ProjectConfig): api.ProjectConfig {
    const base = savedProjectCfgRef.current ?? next;
    const defaults = { ...base.defaults };
    if (field === "max_parallel") defaults.max_parallel = next.defaults.max_parallel;
    if (field === "default_base_branch") defaults.base_branch = next.defaults.base_branch;
    if (field === "cost_limit_usd") defaults.cost_limit_usd = next.defaults.cost_limit_usd;
    if (field === "auto_merge") defaults.auto_merge = next.defaults.auto_merge;
    return { defaults };
  }

  function applyProjectDisplay(field: ProjectField, next: api.ProjectConfig) {
    if (field === "max_parallel") setDraftMaxParallel(next.defaults.max_parallel);
    if (field === "default_base_branch") setDraftBaseBranch(next.defaults.base_branch ?? "");
    if (field === "cost_limit_usd") setDraftCostLimit(String(next.defaults.cost_limit_usd ?? 0));
    if (field === "auto_merge") setDraftAutoMerge(!!next.defaults.auto_merge);
  }

  function scheduleProjectSave(
    field: ProjectField,
    patch: api.ProjectConfigPatch,
    applyDisplay: (next: api.ProjectConfig) => void,
    rollback: () => void
  ) {
    const key: AutosaveKey = `project:${field}`;
    scheduleAutosave(
      key,
      async (signal, seq) => {
        const next = await api.updateConfig(hash, patch, signal);
        if (seqRef.current[key] !== seq) return;
        const merged = mergeProjectSaved(field, next);
        savedProjectCfgRef.current = merged;
        updateConfirmedProjectValue(field, next);
        setCfg(merged);
        applyDisplay(next);
        onSaved?.(merged);
        showSaved();
      },
      (e) => {
        toastSaveError(e);
        rollback();
      }
    );
  }

  function scheduleTaskSave(
    tc: TaskClass,
    field: TaskField,
    patch: TaskModelPatch,
    desiredTask: UserConfig["defaults"][TaskClass],
    rollback: () => void
  ) {
    const key: AutosaveKey = `task:${tc}:${field}`;
    scheduleAutosave(
      key,
      async (signal, seq) => {
        // backend cascade(2026-05-13):改 runner.provider 時 executor/critic/merge.provider 自動同步,
        // 必須拿 response 覆寫 local state,不能只信 desiredTask(只 cover 當 tc)
        const fresh = await userConfigApi.updateUserConfig({ defaults: { [tc]: patch } }, signal);
        if (seqRef.current[key] !== seq) return;
        savedUserCfgRef.current = fresh;
        setUserCfg(fresh);
        setConfirmedTaskValues(fresh);
        showSaved();
      },
      (e) => {
        toastSaveError(e);
        rollback();
      }
    );
  }

  useEffect(() => {
    return () => {
      for (const timer of Object.values(timersRef.current)) {
        if (timer) clearTimeout(timer);
      }
      for (const controller of Object.values(controllersRef.current)) {
        controller?.abort();
      }
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    api
      .getConfig(hash)
      .then((c) => {
        if (cancelled) return;
        setCfg(c);
        savedProjectCfgRef.current = c;
        setConfirmedProjectValues(c);
        setDraftMaxParallel(c.defaults.max_parallel);
        setDraftBaseBranch(c.defaults.base_branch ?? "");
        setDraftCostLimit(String(c.defaults.cost_limit_usd ?? 0));
        setDraftAutoMerge(!!c.defaults.auto_merge);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hash, open]);

  // User-level config 載入
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUserCfgError(null);
    userConfigApi
      .getUserConfig()
      .then((c) => {
        if (cancelled) return;
        savedUserCfgRef.current = c;
        setConfirmedTaskValues(c);
        setUserCfg(c);
      })
      .catch((e: Error) => {
        if (!cancelled) setUserCfgError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function updateTask(tc: TaskClass, patch: TaskModelPatch) {
    if (!userCfg) return;
    const cur = userCfg.defaults[tc];
    const field: TaskField =
      patch.provider !== undefined ? "provider" : patch.model !== undefined ? "model" : "effort";
    let sendPatch = patch;
    const merged = { ...cur, ...patch };
    if (patch.provider && patch.provider !== cur.provider) {
      const np = patch.provider;
      if (patch.model === undefined && !isValidModel(np, merged.model)) {
        merged.model = defaultModelForProvider(np);
        sendPatch = { ...sendPatch, model: merged.model };
      }
      if (patch.effort === undefined && !isValidEffort(np, merged.effort)) {
        merged.effort = defaultEffortForProvider(np);
        sendPatch = { ...sendPatch, effort: merged.effort };
      }
    }
    const next: UserConfig = {
      ...userCfg,
      defaults: {
        ...userCfg.defaults,
        [tc]: merged,
      },
    };
    setUserCfg(next);
    setUserCfgError(null);
    scheduleTaskSave(tc, field, sendPatch, merged, () => {
      const confirmedValues = confirmedTaskValuesRef.current;
      setUserCfg((current) => {
        if (!current) return current;
        let rolledBackTask = { ...current.defaults[tc] };
        for (const patchedField of Object.keys(sendPatch) as TaskField[]) {
          const confirmedValue = confirmedValues[`task:${tc}:${patchedField}`];
          if (confirmedValue !== undefined) {
            rolledBackTask = applyConfirmedTaskValue(rolledBackTask, patchedField, confirmedValue);
          }
        }
        return {
          ...current,
          defaults: {
            ...current.defaults,
            [tc]: rolledBackTask,
          },
        };
      });
    });
  }

  function updatePushEvent(key: PushEventKey, enabled: boolean) {
    if (!userCfg) return;
    const prev = userCfg.pushEvents[key];
    const next: UserConfig = {
      ...userCfg,
      pushEvents: {
        ...userCfg.pushEvents,
        [key]: enabled,
      },
    };
    setUserCfg(next);
    setUserCfgError(null);
    setPushSaving((current) => ({ ...current, [key]: true }));
    userConfigApi
      .updateUserConfig({ pushEvents: { [key]: enabled } })
      .then((fresh) => {
        savedUserCfgRef.current = fresh;
        setUserCfg(fresh);
        setConfirmedTaskValues(fresh);
        showSaved();
      })
      .catch((e: unknown) => {
        toastSaveError(e);
        setUserCfg((current) => {
          if (!current) return current;
          return {
            ...current,
            pushEvents: {
              ...current.pushEvents,
              [key]: prev,
            },
          };
        });
      })
      .finally(() => {
        setPushSaving((current) => ({ ...current, [key]: false }));
      });
  }

  // outside click + Esc 關
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={wrapRef}
      className="settings-popover"
      role="dialog"
      aria-label="設定"
    >
      {/* 手機右上關閉按鈕 — desktop 隱藏(點外面 / Esc 已夠) */}
      <button
        type="button"
        className="settings-popover-close"
        onClick={onClose}
        aria-label="關閉設定"
        title="關閉"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>

      {/* ─── Tab bar + 全域「已儲存」chip ─── */}
      <div className="settings-popover-tabs">
        {(
          [
            { key: "project", label: "Project" },
            { key: "ai", label: "AI 任務" },
            { key: "notifications", label: "PWA" },
            { key: "update", label: "更新" },
            ...(authStatus?.bound === true
              ? ([{ key: "security", label: "安全" }] as const)
              : []),
          ] as ReadonlyArray<{ key: TabKey; label: string }>
        ).map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={"settings-popover-tab" + (isActive ? " is-active" : "")}
            >
              {t.label}
            </button>
          );
        })}
        <span className="settings-popover-tabs-spacer" />
        {savedVisible && (
          <span
            className={"chip settings-popover-saved" + (savedFading ? " is-fading" : "")}
            onTransitionEnd={onSavedTransitionEnd}
          >
            已儲存 ✓
          </span>
        )}
      </div>

      {/* ─── Project tab ─── */}
      {activeTab === "project" && (
        <div className="settings-tab-content">
          <div className="task-group task-group--primary">
      <div className="settings-field-row">
        <label className="settings-field-label">平行上限</label>
        <div className="settings-field-controls">
          <input
            type="number"
            min={MIN}
            max={MAX}
            step={1}
            value={draftMaxParallel}
            onChange={(e) => {
              const nextValue = Number(e.target.value);
              const clamped = Math.max(MIN, Math.min(MAX, Math.floor(nextValue || MIN)));
              setDraftMaxParallel(nextValue);
              scheduleProjectSave(
                "max_parallel",
                { defaults: { max_parallel: clamped } },
                (next) => applyProjectDisplay("max_parallel", next),
                () => {
                  const confirmedValue = confirmedProjectValuesRef.current?.max_parallel;
                  if (confirmedValue !== undefined) setDraftMaxParallel(confirmedValue);
                }
              );
            }}
            disabled={!cfg}
            className="mono settings-input settings-input--w-narrow"
          />
          <span className="mono settings-inline-unit">
            {MIN}–{MAX} 條
          </span>
        </div>
      </div>
      <div className="settings-subhint">達到上限後新 Run 排隊,前面跑完自動接棒。</div>

      <div className="settings-field-row">
        <label className="settings-field-label">Base branch</label>
        <input
          type="text"
          value={draftBaseBranch}
          onChange={(e) => {
            const nextValue = e.target.value;
            setDraftBaseBranch(nextValue);
            scheduleProjectSave(
              "default_base_branch",
              { defaults: { default_base_branch: nextValue.trim() } },
              (next) => applyProjectDisplay("default_base_branch", next),
              () => {
                const confirmedValue = confirmedProjectValuesRef.current?.default_base_branch;
                if (confirmedValue !== undefined) setDraftBaseBranch(confirmedValue);
              }
            );
          }}
          disabled={!cfg}
          placeholder={cfg?.defaults.base_branch || "main"}
          className="mono settings-input settings-input--w-full"
        />
      </div>
      <div className="settings-subhint">新 pipeline 預設從這個 branch 切。</div>

      <div className="settings-field-row">
        <label className="settings-field-label">Cost 上限</label>
        <div className="settings-field-controls">
          <input
            type="number"
            min={0}
            step={0.01}
            value={draftCostLimit}
            onChange={(e) => {
              const nextValue = e.target.value;
              setDraftCostLimit(nextValue);
              scheduleProjectSave(
                "cost_limit_usd",
                { defaults: { cost_limit_usd: Number(nextValue) } },
                (next) => applyProjectDisplay("cost_limit_usd", next),
                () => {
                  const confirmedValue = confirmedProjectValuesRef.current?.cost_limit_usd;
                  if (confirmedValue !== undefined) setDraftCostLimit(confirmedValue);
                }
              );
            }}
            disabled={!cfg}
            placeholder="0"
            className="mono settings-input settings-input--w-mid"
          />
          <span className="mono settings-inline-unit">USD,0 = 無限</span>
        </div>
      </div>
      <div className="settings-subhint">每條 pipeline 個別累積上限,超過擋該 pipeline /run 不影響其他。</div>

      <div className="settings-field-row settings-field-row--tight">
        <span className="settings-field-label">自動合併</span>
        <label
          className={"toggle-pill mono" + (draftAutoMerge ? " is-on" : "")}
          title="全 ticket done → backend 自動 append merge ticket 走 runner 流程"
          style={{ alignSelf: "start" }}
        >
          <input
            type="checkbox"
            checked={draftAutoMerge}
            onChange={(e) => {
              const nextValue = e.target.checked;
              setDraftAutoMerge(nextValue);
              scheduleProjectSave(
                "auto_merge",
                { defaults: { auto_merge: nextValue } },
                (next) => applyProjectDisplay("auto_merge", next),
                () => {
                  const confirmedValue = confirmedProjectValuesRef.current?.auto_merge;
                  if (confirmedValue !== undefined) setDraftAutoMerge(confirmedValue);
                }
              );
            }}
            disabled={!cfg}
          />
          <span className="toggle-pill-track" aria-hidden>
            <span className="toggle-pill-thumb" />
          </span>
          新 pipeline 預設啟用
        </label>
      </div>
      <div className="settings-subhint">每條 pipeline 也可單獨切換。</div>
          </div>
        </div>
      )}

      {/* ─── AI 任務 tab ─── */}
      {activeTab === "ai" && (
        <div className="settings-tab-content">
          {userCfg ? (
            <>
              {/* Group 1:獨立 agent(各自挑 provider) */}
              <div className="task-group task-group--primary">
                <div className="settings-section-title">全域 provider / model 設定</div>
                <div className="settings-popover-task-grid">
                  {(["qa", "split", "runner"] as const).map((tc) => (
                    <TaskModelRow
                      key={tc}
                      label={TASK_CLASS_LABELS[tc]}
                      hint={TASK_CLASS_HINTS[tc]}
                      provider={userCfg.defaults[tc].provider}
                      model={userCfg.defaults[tc].model}
                      effort={userCfg.defaults[tc].effort}
                      showProvider
                      onChange={(patch) => updateTask(tc, patch)}
                    />
                  ))}
                </div>
              </div>
              {/* Group 2:跟主 agent(只挑 model / effort,provider 跟 runner) */}
              <div className="task-group task-group--secondary">
                <div className="task-group-hint">
                  ↑ 為了加快速度和節省 Token,預設跟隨 Main Agent 設定
                </div>
                <div className="settings-popover-task-grid">
                  {(["executor", "critic", "merge"] as const).map((tc) => (
                    <TaskModelRow
                      key={tc}
                      label={TASK_CLASS_LABELS[tc]}
                      hint={TASK_CLASS_HINTS[tc]}
                      provider={userCfg.defaults[tc].provider}
                      model={userCfg.defaults[tc].model}
                      effort={userCfg.defaults[tc].effort}
                      onChange={(patch) => updateTask(tc, patch)}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="settings-subhint">載入中…</div>
          )}
          {userCfgError && (
            <div className="mono settings-error">{userCfgError}</div>
          )}
          {error && (
            <div className="mono settings-error">{error}</div>
          )}
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="settings-tab-content">
          <div className="task-group task-group--primary">
            <InstallAppSection onActionError={onActionError} />
          </div>
          <div className="task-group task-group--primary">
            <div className="settings-section-title">推播通知</div>
            <PushNotificationsSection
              userCfg={userCfg}
              pushSaving={pushSaving}
              onTogglePushEvent={updatePushEvent}
              onActionError={onActionError}
            />
          </div>
        </div>
      )}

      {activeTab === "update" && (
        <div className="settings-tab-content">
          <UpdateTab onActionError={onActionError} />
        </div>
      )}

      {activeTab === "security" && authStatus?.bound === true && (
        <SecurityTab status={authStatus} onActionError={onActionError} />
      )}

    </div>
  );
}

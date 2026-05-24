// Settings popover — mirrors src/features/settings/{SettingsPopover,ProjectTab,AITab,NotificationsTab,UpdateTab}.tsx
// DOM + className faithful to the live app; iter logic / API calls stripped (local state stubs only).
// RWD: desktop = anchored popover (480px), mobile (<768px) = fullscreen sheet — handled in settings.css.
const { useState: useSt, useRef: useRf } = React;

/* ─── icons ─── */
function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>);
}
function CheckSm() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 12.5 5.5 5.5L20 6" />
    </svg>);
}
function CaretDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>);
}
function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="9" r="2.4" />
      <path d="M6 8.4v7.2M8 6h4a4 4 0 0 1 4 4v.6" />
    </svg>);
}
function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>);
}
function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M10 14 21 3M21 14v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
    </svg>);
}

/* ─── shared atoms (real DOM shape of NumberField / PickerTrigger / toggle-pill) ─── */
function NumberField({ value, onChange, min, max, step, fieldClassName, inputClassName, labelLabel }) {
  return (
    <div className={"form-field" + (fieldClassName ? " " + fieldClassName : "")}>
      <label className="form-label form-label--sr"><span>{labelLabel}</span></label>
      <input
        type="number" inputMode="numeric"
        className={"form-input" + (inputClassName ? " " + inputClassName : "")}
        value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    </div>);
}

function PickerTrigger({ icon, label, mono, open, onClick }) {
  return (
    <div className="picker">
      <button type="button"
        className={"picker-trigger" + (open ? " is-open" : "")}
        onClick={onClick}>
        {icon}
        <span className={mono ? "mono" : ""}>{label}</span>
        <span style={{ flex: 1 }} />
        <CaretDown />
      </button>
    </div>);
}

function SavedChip({ visible, fading }) {
  if (!visible) return null;
  return (
    <span className={"chip settings-popover-saved" + (fading ? " is-fading" : "")}>
      已儲存 <CheckSm />
    </span>);
}

/* ════════════════════════════════════════════════
   ProjectTab — mirrors src/features/settings/ProjectTab.tsx
   ════════════════════════════════════════════════ */
function ProjectTab({ notifySaved }) {
  const [parallel, setParallel] = useSt(2);
  const [baseBranch, setBaseBranch] = useSt("main");
  const [costLimit, setCostLimit] = useSt("0");
  const [autoMerge, setAutoMerge] = useSt(false);
  const [pickerOpen, setPickerOpen] = useSt(false);
  const ping = () => notifySaved && notifySaved();

  return (
    <div className="settings-tab-content">
      <div className="task-group task-group--primary">
        <div className="settings-field-row">
          <span className="settings-field-label">平行上限</span>
          <div className="settings-field-controls">
            <NumberField
              labelLabel="平行上限"
              fieldClassName="settings-form-field settings-form-field--narrow"
              inputClassName="mono"
              value={parallel} min={1} max={8} step={1}
              onChange={(v) => { setParallel(v === "" ? 1 : Math.max(1, Math.min(8, Math.floor(v)))); ping(); }} />
            <span className="mono settings-inline-unit">1–8 條</span>
          </div>
        </div>
        <div className="settings-subhint">達到上限後，新執行會排隊，前一個完成後自動開始。</div>

        <div className="settings-field-row">
          <label className="settings-field-label">基礎分支</label>
          <div className="settings-field-controls">
            <PickerTrigger
              icon={<span className="mono" style={{ color: "var(--fg-mute)", display: "inline-flex" }}><BranchIcon /></span>}
              label={baseBranch} mono open={pickerOpen}
              onClick={() => setPickerOpen(!pickerOpen)} />
          </div>
        </div>
        <div className="settings-subhint">新 pipeline 預設從此 branch 建立。</div>

        <div className="settings-field-row">
          <span className="settings-field-label">單次成本上限</span>
          <div className="settings-field-controls">
            <NumberField
              labelLabel="單條 pipeline 成本上限"
              fieldClassName="settings-form-field settings-form-field--mid"
              inputClassName="mono"
              value={costLimit === "" ? "" : Number(costLimit)} min={0} step={0.01}
              onChange={(v) => { setCostLimit(v === "" ? "" : String(v)); ping(); }} />
            <span className="mono settings-inline-unit">USD</span>
          </div>
        </div>
        <div className="settings-subhint settings-subhint-desktop">每條 pipeline 的成本上限，0 代表不限制。超過時只阻止該 pipeline 的下一次執行，不影響其他 pipeline。</div>
        <div className="settings-subhint settings-subhint-mobile">每條 pipeline 的上限，0 代表不限制。超過時只阻止下一次執行。</div>

        <div className="settings-field-row settings-field-row--tight">
          <span className="settings-field-label">自動合併</span>
          <label className={"toggle-pill" + (autoMerge ? " is-on" : "")}>
            <input type="checkbox" checked={autoMerge}
              onChange={(e) => { setAutoMerge(e.target.checked); ping(); }} />
            <span className="toggle-pill-track" aria-hidden><span className="toggle-pill-thumb" /></span>
            新 pipeline 預設啟用
          </label>
        </div>
        <div className="settings-subhint">每條 pipeline 仍可個別覆寫此設定。</div>
      </div>
    </div>);
}

/* ════════════════════════════════════════════════
   AITab — mirrors src/features/settings/AITab.tsx
   ════════════════════════════════════════════════ */
// verbatim from shared/types.ts
const TASK_CLASS_LABELS = {
  qa: "QA Spec",
  split: "Ticket Split",
  runner: "Main Agent",
  executor: "Executor",
  critic: "Critic",
  merge: "Merge Agent",
};
const TASK_CLASS_HINTS = {
  qa: "規格收斂",
  split: "大任務拆分 Ticket",
  runner: "任務執行主 Agent",
  executor: "執行AI(改 code)",
  critic: "審核AI(判 PASS/FAIL)",
  merge: "合併衝突解決",
};
// verbatim from shared/types.ts:44-69
const PROVIDERS = ["claude", "codex"];
const MODELS_BY_PROVIDER = {
  claude: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-opus-4-6",
  ],
  codex: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"],
};
const EFFORTS_BY_PROVIDER = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high"],
};
const defaultModelForProvider = (p) => MODELS_BY_PROVIDER[p][0];
const defaultEffortForProvider = (p) => EFFORTS_BY_PROVIDER[p][1] ?? EFFORTS_BY_PROVIDER[p][0];
const modelsForProvider = (p) => MODELS_BY_PROVIDER[p];
const effortsForProvider = (p) => EFFORTS_BY_PROVIDER[p];

function TaskModelRow({ label, hint, provider, model, effort, showProvider, onChange }) {
  return (
    <div className="task-row">
      <div className="task-row-head">
        <span className="task-row-label">{label}</span>
        <div className="task-row-selects">
          {showProvider ? (
            <select value={provider} aria-label={label + " provider"}
              onChange={(e) => onChange({ provider: e.target.value })}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <span className="task-row-placeholder" aria-hidden />
          )}
          <select value={model} aria-label={label + " model"}
            onChange={(e) => onChange({ model: e.target.value })}>
            {modelsForProvider(provider).map((m) => (
              <option key={m} value={m}>{m.replace(/^claude-/, "")}</option>
            ))}
          </select>
          <select value={effort} aria-label={label + " effort"}
            onChange={(e) => onChange({ effort: e.target.value })}>
            {effortsForProvider(provider).map((eff) => (
              <option key={eff} value={eff}>{eff}</option>
            ))}
          </select>
        </div>
      </div>
      {hint && <div className="task-row-hint">{hint}</div>}
    </div>);
}

function AITab({ notifySaved }) {
  const mk = (p) => ({ provider: p, model: defaultModelForProvider(p), effort: defaultEffortForProvider(p) });
  const [cfg, setCfg] = useSt({
    qa: mk("claude"), split: mk("claude"), runner: mk("claude"),
    executor: mk("claude"), critic: mk("claude"), merge: mk("claude"),
  });
  function patch(tc, p) {
    setCfg((s) => {
      // provider 切換 → model/effort 重置為新 provider 預設,避免 cross-provider invalid value
      if (p.provider && p.provider !== s[tc].provider) {
        return { ...s, [tc]: mk(p.provider) };
      }
      return { ...s, [tc]: { ...s[tc], ...p } };
    });
    notifySaved && notifySaved();
  }
  return (
    <div className="settings-tab-content">
      <div className="task-group task-group--primary">
        <div className="settings-section-title">全域 provider / model 設定</div>
        <div className="settings-popover-task-grid">
          {["qa", "split", "runner"].map((tc) => (
            <TaskModelRow key={tc} label={TASK_CLASS_LABELS[tc]} hint={TASK_CLASS_HINTS[tc]}
              provider={cfg[tc].provider} model={cfg[tc].model} effort={cfg[tc].effort}
              showProvider onChange={(p) => patch(tc, p)} />
          ))}
        </div>
      </div>
      <div className="task-group task-group--secondary">
        <div className="settings-section-title">執行階段 Agent</div>
        <div className="task-group-hint">
          <ArrowUpIcon aria-hidden /> 為了加快速度和節省 Token，預設跟隨上方 Main Agent 設定。
        </div>
        <div className="settings-popover-task-grid">
          {["executor", "critic", "merge"].map((tc) => (
            <TaskModelRow key={tc} label={TASK_CLASS_LABELS[tc]} hint={TASK_CLASS_HINTS[tc]}
              provider={cfg[tc].provider} model={cfg[tc].model} effort={cfg[tc].effort}
              onChange={(p) => patch(tc, p)} />
          ))}
        </div>
      </div>
    </div>);
}

/* ════════════════════════════════════════════════
   NotificationsTab — mirrors src/features/settings/NotificationsTab.tsx
   ════════════════════════════════════════════════ */
const PUSH_EVENT_LABELS = [
  { key: "ticket_done", label: "Ticket 完成" },
  { key: "ticket_failed", label: "Ticket 失敗" },
  { key: "pipeline_paused", label: "Pipeline 暫停需回應" },
  { key: "pipeline_ready", label: "Pipeline 跑完" },
  { key: "auto_merge_conflict", label: "衝突交由 AI 處理" },
];

// PushStateBlock — all 6 branches (loading + 5 kinds) verbatim from NotificationsTab.tsx
function PushStateBlock({ state, loading }) {
  if (loading) return (
    <div className="push-state push-state--info" role="status" aria-live="polite">
      <div className="push-state-title">處理中…</div>
      <div className="push-state-sub">正在更新此裝置的推播設定，請稍候。</div>
    </div>);
  if (state === "checking") return (
    <div className="push-state push-state--info" role="status" aria-live="polite">
      <div className="push-state-title">檢查推播支援中…</div>
      <div className="push-state-sub">正在確認此瀏覽器是否支援 Web Push。</div>
    </div>);
  if (state === "unsupported") return (
    <div className="push-state push-state--error" role="status" aria-live="polite">
      <div className="push-state-head">
        <span className="push-state-badge">不支援</span>
        <div className="push-state-title">此瀏覽器不支援 Web Push</div>
      </div>
      <div className="push-state-sub">可改用桌面 Chrome / Edge / Firefox，或將本站安裝為 App 後再嘗試啟用。</div>
    </div>);
  if (state === "denied") return (
    <div className="push-state push-state--error" role="status" aria-live="polite">
      <div className="push-state-head">
        <span className="push-state-badge">已封鎖</span>
        <div className="push-state-title">已被瀏覽器封鎖</div>
      </div>
      <div className="push-state-sub">請先在瀏覽器解除封鎖，再回此頁啟用推播：</div>
      <ul className="push-state-steps">
        <li><strong>Chrome / Edge</strong>：點網址列左側的鎖頭或調整圖示 → 網站設定 → 通知 → 改為「允許」。</li>
        <li><strong>Safari</strong>：「Safari → 設定 → 網站 → 通知」找到本站並改為「允許」。</li>
        <li>解除後重新整理此頁，再回到此設定啟用。</li>
      </ul>
    </div>);
  if (state === "default") return (
    <div className="push-state push-state--neutral" role="status" aria-live="polite">
      <div className="push-state-title">尚未啟用</div>
      <div className="push-state-sub">開啟後可選擇接收哪些事件。瀏覽器會先詢問通知權限。</div>
    </div>);
  if (state === "granted") return (
    <div className="push-state push-state--ok" role="status" aria-live="polite">
      <div className="push-state-head">
        <span className="push-state-badge push-state-badge--ok">已啟用</span>
        <div className="push-state-title">已啟用此裝置的推播</div>
      </div>
      <div className="push-state-sub">下方可選擇要接收哪些事件，變更會自動儲存。</div>
    </div>);
  return null;
}

// InstallAppSection — 3 branches verbatim from NotificationsTab.tsx
function InstallAppSection({ installState, busy }) {
  // installState: "installed" | "canInstall" | "unavailable"
  return (
    <>
      <div className="settings-section-title">安裝為 App</div>
      {installState === "canInstall" && (
        <div className="push-action-row">
          <button type="button" className="btn" disabled={busy}>
            {busy ? "處理中…" : "安裝 App"}
          </button>
        </div>
      )}
      <div className="push-hint push-hint--inline">
        {installState === "installed" ? (
          "已安裝，直接從 App 圖示開啟即可。"
        ) : installState === "canInstall" ? (
          "安裝後可全螢幕、推播更穩。"
        ) : (
          <>
            此瀏覽器未提供安裝按鈕。可能已安裝過，或需從瀏覽器手動安裝：
            <ul className="push-hint-list">
              <li>Chrome / Edge：點網址列右側的安裝圖示（⊕）。</li>
              <li>iOS Safari：點下方「分享」→「加入主畫面」。</li>
            </ul>
          </>
        )}
      </div>
    </>);
}

function NotificationsTab({ notifySaved }) {
  // 改 useSt 初值就能看其他 state。完整 5 個 push state + 3 個 install state 都在 JSX 內。
  const [state, setState] = useSt("granted");      // "checking" | "unsupported" | "denied" | "default" | "granted"
  const [loading, setLoading] = useSt(false);
  const [installState, setInstallState] = useSt("canInstall"); // "installed" | "canInstall" | "unavailable"
  const [events, setEvents] = useSt({
    ticket_done: true, ticket_failed: true,
    pipeline_paused: true, pipeline_ready: false,
    auto_merge_conflict: true,
  });
  const enabled = state === "granted";
  const disabled = state !== "default" && state !== "granted" || loading;

  return (
    <div className="settings-tab-content">
      <div className="task-group task-group--primary">
        <div className="settings-section-title">推播通知</div>
        <div className="push-section">
          <div className="push-toggle-row">
            <label className={
              "toggle-pill mono" + (enabled ? " is-on" : "") + (disabled ? " is-disabled" : "")
            } aria-disabled={disabled || undefined}>
              <input type="checkbox" role="switch" checked={enabled} disabled={disabled}
                onChange={(e) => { setState(e.target.checked ? "granted" : "default"); notifySaved && notifySaved(); }} />
              <span className="toggle-pill-track" aria-hidden><span className="toggle-pill-thumb" /></span>
              {enabled ? "推播通知已啟用" : loading ? "處理中…" : "啟用推播通知"}
            </label>
          </div>
          <PushStateBlock state={state} loading={loading} />
          {enabled && (
            <div className="settings-popover-task-grid push-events-grid" aria-label="推播事件">
              {PUSH_EVENT_LABELS.map((item) => {
                const on = events[item.key];
                return (
                  <label key={item.key} className={"toggle-pill mono" + (on ? " is-on" : "")}>
                    <input type="checkbox" role="switch" checked={on}
                      onChange={(e) => { setEvents((s) => ({ ...s, [item.key]: e.target.checked })); notifySaved && notifySaved(); }} />
                    <span className="toggle-pill-track" aria-hidden><span className="toggle-pill-thumb" /></span>
                    {item.label}
                  </label>);
              })}
            </div>
          )}
        </div>
      </div>
      <div className="task-group task-group--primary">
        <InstallAppSection installState={installState} busy={false} />
      </div>
    </div>);
}

/* ════════════════════════════════════════════════
   UpdateTab — mirrors src/features/settings/UpdateTab.tsx
   ════════════════════════════════════════════════ */
function Spinner() {
  return (
    <svg className="update-progress-spinner spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-6.2-8.55" />
    </svg>);
}

function UpdateTab({ notifySaved }) {
  // 改 useSt 初值看其他 state。完整 5 個 phase + dev-build / no-latest 分支都在 JSX。
  const [phase, setPhase] = useSt("idle"); // "idle" | "starting" | "polling" | "done" | "error"
  const [pollingSub, setPollingSub] = useSt("down"); // "before-down" | "down" | "reconnecting"
  const [errorReason, setErrorReason] = useSt("系統更新後超過 3 分鐘仍未恢復連線。請重新整理頁面，或稍後再檢查。");
  const current = "v0.42.1";
  const latest = { tag: "v0.43.0", url: "#" }; // 設 null 看「無法取得發行版資訊」
  const hasUpdate = !!latest && current !== latest.tag;
  const isDevBuild = /^dev-|-dirty$/.test(current);
  const loading = false;
  const isUpdating = phase === "starting" || phase === "polling";
  const isError = phase === "error";

  function onApply() {
    setPhase("starting");
    setTimeout(() => { setPhase("polling"); setPollingSub("before-down"); }, 600);
    setTimeout(() => setPollingSub("down"), 1500);
    setTimeout(() => setPollingSub("reconnecting"), 2400);
    setTimeout(() => setPhase("done"), 3000);
  }

  return (
    <div className="task-group task-group--primary">
      <div className="settings-section-title">應用版本</div>
      <div className="update-tab-body" aria-busy={isUpdating || undefined}>
        <div className="update-summary">
          <div className="update-summary-headline">
            <span className="mono update-version-current" title={current}>{current}</span>
            {!hasUpdate && !isDevBuild && latest && (
              <span className="vp-chip vp-chip--success">已是最新</span>
            )}
            {hasUpdate && !isDevBuild && (
              <span className="vp-chip vp-chip--info">有新 release</span>
            )}
          </div>
          {latest ? (
            <div className="update-summary-sub">
              最新發行版{" "}
              <span className={"mono update-version-latest" + (hasUpdate ? " update-version-latest--accent" : "")}>
                {latest.tag}
              </span>
              <span className="update-summary-sep" aria-hidden>·</span>
              <a href={latest.url} target="_blank" rel="noopener noreferrer"
                className="update-release-link" aria-label="開啟發行說明（新視窗）">
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
            <button type="button" className="btn"
              onClick={() => notifySaved && notifySaved()}
              disabled={loading || isUpdating}>
              {loading ? "檢查中…" : "檢查更新"}
            </button>
          )}
          {hasUpdate && !isDevBuild && !isError && (
            <button type="button" className="btn btn-primary"
              onClick={onApply} disabled={isUpdating}>
              {phase === "starting" ? "啟動中…"
                : phase === "polling" ? "更新中…"
                : "立即更新"}
            </button>
          )}
          {isDevBuild && !isError && (
            <button type="button" className="btn"
              onClick={onApply} disabled={isUpdating}
              title="切回最新正式 release（會覆蓋目前 dev / dirty build）">
              {phase === "starting" ? "啟動中…"
                : phase === "polling" ? "更新中…"
                : "切回正式 release"}
            </button>
          )}
        </div>

        <div className="update-last-checked">上次檢查：剛剛</div>

        {phase === "starting" && (
          <div className="update-progress" role="status" aria-live="polite">
            <Spinner />
            <div className="update-progress-text">
              <div className="update-progress-title">啟動更新中…</div>
              <div className="update-progress-sub">已送出更新指令，等待 backend 接手。</div>
            </div>
          </div>
        )}

        {phase === "polling" && (
          <div className="update-progress" role="status" aria-live="polite">
            <Spinner />
            <div className="update-progress-text">
              <div className="update-progress-title">backend 重啟中，通常需 30-60 秒</div>
              <div className="update-progress-sub">
                {pollingSub === "before-down"
                  ? "等待 backend 下線…（更新流程預期會短暫離線）"
                  : pollingSub === "down"
                    ? "backend 暫時離線中，持續確認回應…"
                    : "已重新連線，正在確認版本…"}
              </div>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="update-success" role="status" aria-live="polite">
            <CheckSm aria-hidden />
            <div className="update-success-text">
              <div className="update-success-title">
                已更新到 <span className="mono update-success-tag">{latest ? latest.tag : ""}</span>，重新整理頁面後生效。
              </div>
              <div className="update-success-actions">
                <button type="button" className="btn btn-primary"
                  onClick={() => setPhase("idle")}>重新整理頁面</button>
              </div>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="update-error" role="alert" aria-live="assertive">
            <div className="update-error-title">更新未完成</div>
            <div className="update-error-reason">{errorReason}</div>
            <div className="update-error-actions">
              <button type="button" className="btn btn-primary"
                onClick={() => setPhase("idle")}>重新整理頁面</button>
              <button type="button" className="btn"
                onClick={() => setPhase("idle")}>重新檢查連線</button>
            </div>
          </div>
        )}
      </div>
    </div>);
}

/* ════════════════════════════════════════════════
   SettingsPopover root — mirrors src/features/settings/SettingsPopover.tsx
   ════════════════════════════════════════════════ */
const TABS = [
  { key: "project",       label: "專案",    Comp: ProjectTab },
  { key: "ai",            label: "AI 任務", Comp: AITab },
  { key: "notifications", label: "通知",    Comp: NotificationsTab },
  { key: "update",        label: "更新",    Comp: UpdateTab },
];

function SettingsPopover({ onClose }) {
  const [active, setActive] = useSt("project");
  const [savedVisible, setSavedVisible] = useSt(false);
  const [savedFading, setSavedFading] = useSt(false);
  const timerRef = useRf(null);

  function notifySaved() {
    setSavedVisible(true); setSavedFading(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSavedFading(true), 2400);
    setTimeout(() => { setSavedVisible(false); setSavedFading(false); }, 3200);
  }
  function onTabKey(e, idx) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const len = TABS.length;
    let next = idx;
    if (e.key === "ArrowLeft") next = (idx - 1 + len) % len;
    else if (e.key === "ArrowRight") next = (idx + 1) % len;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = len - 1;
    setActive(TABS[next].key);
  }
  const ActiveComp = TABS.find((t) => t.key === active).Comp;
  return (
    <div className="settings-popover" role="dialog" aria-label="設定">
      <button type="button" className="settings-popover-close"
        onClick={onClose} aria-label="關閉設定" title="關閉">
        <XIcon />
      </button>
      <div className="settings-popover-tabs" role="tablist" aria-label="設定分頁">
        {TABS.map((t, idx) => {
          const isActive = active === t.key;
          return (
            <button key={t.key} type="button" role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(t.key)}
              onKeyDown={(e) => onTabKey(e, idx)}
              className={"settings-popover-tab" + (isActive ? " is-active" : "")}>
              {t.label}
            </button>);
        })}
        <span className="settings-popover-tabs-spacer" />
        <SavedChip visible={savedVisible} fading={savedFading} />
      </div>
      <ActiveComp notifySaved={notifySaved} />
    </div>);
}

Object.assign(window, { SettingsPopover });

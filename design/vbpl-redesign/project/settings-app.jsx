// Settings redesign — top-level app shell + Tweaks panel for switching variants

const { useState, useEffect, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "variant": "refined",
  "theme": "dark",
  "activeTab": "project",
  "pushState": "granted",
  "installState": "canInstall",
  "updatePhase": "idle",
  "openByDefault": true
}/*EDITMODE-END*/;

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>);
}

const TABS = [
  { key: "project",       label: "專案" },
  { key: "ai",            label: "AI 任務" },
  { key: "notifications", label: "通知" },
  { key: "update",        label: "更新" },
];

function SettingsPopover({ onClose, variant, activeTab, onTabChange, pushState, installState, updatePhase }) {
  const [active, setActive] = useState(activeTab || "project");
  const [savedVisible, setSavedVisible] = useState(false);
  const [savedFading, setSavedFading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => { setActive(activeTab || "project"); }, [activeTab]);

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
    const k = TABS[next].key;
    setActive(k);
    onTabChange && onTabChange(k);
  }

  let body = null;
  if (active === "project") body = <ProjectTab notifySaved={notifySaved} />;
  else if (active === "ai") body = <AITab notifySaved={notifySaved} />;
  else if (active === "notifications") body = <NotificationsTab notifySaved={notifySaved} pushState={pushState} installState={installState} />;
  else if (active === "update") body = <UpdateTab notifySaved={notifySaved} initialPhase={updatePhase} />;

  return (
    <div className={"settings-popover fade-up" + (variant === "refined" ? " refined" : "")} role="dialog" aria-label="設定">
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
              onClick={() => { setActive(t.key); onTabChange && onTabChange(t.key); }}
              onKeyDown={(e) => onTabKey(e, idx)}
              className={"settings-popover-tab" + (isActive ? " is-active" : "")}>
              {t.label}
            </button>);
        })}
        <span className="settings-popover-tabs-spacer"></span>
        <SavedChip visible={savedVisible} fading={savedFading} />
      </div>
      {body}
    </div>);
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [open, setOpen] = useState(t.openByDefault);

  // sync theme class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle("light", t.theme === "light");
  }, [t.theme]);

  // close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <React.Fragment>
      <header className="proto-topbar">
        <span className="proto-topbar-brand">vibe-pipeline</span>
        <span className="proto-topbar-brand-tag mono">settings · {t.variant}</span>
        <span className="proto-topbar-spacer"></span>
        <div className="proto-anchor">
          <button type="button"
            className={"proto-gear" + (open ? " is-open" : "")}
            aria-label="開啟設定" aria-expanded={open}
            onClick={() => setOpen((o) => !o)}>
            <GearIcon />
          </button>
          {open && (
            <SettingsPopover
              variant={t.variant}
              activeTab={t.activeTab}
              onTabChange={(k) => setTweak("activeTab", k)}
              pushState={t.pushState}
              installState={t.installState}
              updatePhase={t.updatePhase}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      </header>

      <main className="proto-stage" onClick={() => open && setOpen(false)}>
        {!open && (
          <div className="proto-hint" aria-hidden>
            點右上角 <kbd>⚙</kbd> 開啟設定
            <br />
            <span style={{ opacity: 0.7 }}>Tweaks 可切換 原樣 / 優化版</span>
          </div>
        )}
      </main>

      {open && <div className="proto-scrim" onClick={() => setOpen(false)} aria-hidden></div>}

      <TweaksPanel title="Tweaks">
        <TweakSection label="樣式" />
        <TweakRadio label="版本" value={t.variant}
          options={["original", "refined"]}
          onChange={(v) => setTweak("variant", v)} />
        <TweakRadio label="主題" value={t.theme}
          options={["dark", "light"]}
          onChange={(v) => setTweak("theme", v)} />

        <TweakSection label="瀏覽" />
        <TweakSelect label="目前分頁" value={t.activeTab}
          options={[
            { label: "專案", value: "project" },
            { label: "AI 任務", value: "ai" },
            { label: "通知", value: "notifications" },
            { label: "更新", value: "update" },
          ]}
          onChange={(v) => { setTweak("activeTab", v); setOpen(true); }} />
        <TweakToggle label="開啟設定" value={open}
          onChange={(v) => setOpen(v)} />

        <TweakSection label="通知分頁狀態" />
        <TweakSelect label="推播狀態" value={t.pushState}
          options={[
            { label: "已啟用 (granted)", value: "granted" },
            { label: "未啟用 (default)", value: "default" },
            { label: "已封鎖 (denied)", value: "denied" },
            { label: "不支援 (unsupported)", value: "unsupported" },
            { label: "檢查中 (checking)", value: "checking" },
          ]}
          onChange={(v) => setTweak("pushState", v)} />
        <TweakSelect label="安裝狀態" value={t.installState}
          options={[
            { label: "可安裝", value: "canInstall" },
            { label: "已安裝", value: "installed" },
            { label: "無法安裝", value: "unavailable" },
          ]}
          onChange={(v) => setTweak("installState", v)} />

        <TweakSection label="更新分頁狀態" />
        <TweakSelect label="更新階段" value={t.updatePhase}
          options={[
            { label: "閒置", value: "idle" },
            { label: "啟動中", value: "starting" },
            { label: "更新中", value: "polling" },
            { label: "完成", value: "done" },
            { label: "錯誤", value: "error" },
          ]}
          onChange={(v) => setTweak("updatePhase", v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

import {
  PROVIDERS,
  TASK_CLASSES,
  TASK_CLASS_HINTS,
  TASK_CLASS_LABELS,
  effortsForProvider,
  modelsForProvider,
  type Effort,
  type ModelName,
  type Provider,
  type TaskClass,
  type UserConfig,
} from "../../../shared/types";
import { ArrowUpIcon } from "../../ui/icons";
import "./SettingsPopover.css";

type TaskModelPatch = { provider?: Provider; model?: ModelName; effort?: Effort };

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

export function AITab({
  userCfg,
  userCfgError,
  projectError,
  onTaskChange,
}: {
  userCfg: UserConfig | null;
  userCfgError: string | null;
  projectError: string | null;
  onTaskChange: (tc: TaskClass, patch: TaskModelPatch) => void;
}) {
  void TASK_CLASSES;
  return (
    <div className="settings-tab-content">
      {userCfg ? (
        <>
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
                  onChange={(patch) => onTaskChange(tc, patch)}
                />
              ))}
            </div>
          </div>
          <div className="task-group task-group--secondary">
            <div className="settings-section-title">執行階段 Agent</div>
            <div className="task-group-hint">
              <ArrowUpIcon aria-hidden /> 為了加快速度和節省 Token，預設跟隨上方 Main Agent 設定。
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
                  onChange={(patch) => onTaskChange(tc, patch)}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="settings-subhint">載入中…</div>
      )}
      {userCfgError && <div className="mono settings-error">{userCfgError}</div>}
      {projectError && <div className="mono settings-error">{projectError}</div>}
    </div>
  );
}

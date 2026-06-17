import {
  PROVIDERS,
  TASK_CLASSES,
  TASK_CLASS_HINTS,
  TASK_CLASS_LABELS,
  type Effort,
  type ModelName,
  type Provider,
  type TaskClass,
  type UserConfig,
} from "../../../shared/types";
import { ArrowUpIcon } from "../../ui/icons";
import { useModelCatalog } from "./useModelCatalog";
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
  models,
  efforts,
  onChange,
}: {
  label: string;
  hint?: string;
  provider: Provider;
  model: ModelName;
  effort: Effort;
  disabled?: boolean;
  showProvider?: boolean;
  models: (p: Provider) => readonly string[];
  efforts: (p: Provider) => readonly string[];
  onChange: (patch: { provider?: Provider; model?: ModelName; effort?: Effort }) => void;
}) {
  return (
    <div className="task-row">
      <div className="task-row-head">
        <span className="task-row-label">
          {label}
          {hint && <span className="task-row-inline-hint">· {hint}</span>}
        </span>
        <div className="task-row-selects">
          {showProvider ? (
            <select
              className="task-row-provider"
              value={provider}
              disabled={disabled}
              aria-label={`${label} provider`}
              onChange={(e) => onChange({ provider: e.target.value as Provider })}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : (
            <span className="task-row-placeholder" aria-hidden />
          )}
          <select
            className="task-row-model"
            value={model}
            disabled={disabled}
            aria-label={`${label} model`}
            onChange={(e) => onChange({ model: e.target.value as ModelName })}
          >
            {models(provider).map((m) => (
              <option key={m} value={m}>
                {m.replace(/^claude-/, "")}
              </option>
            ))}
          </select>
          <select
            className="task-row-effort"
            value={effort}
            disabled={disabled}
            aria-label={`${label} effort`}
            onChange={(e) => onChange({ effort: e.target.value as Effort })}
          >
            {efforts(provider).map((eff) => (
              <option key={eff} value={eff}>
                {eff}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function AITab({
  userCfg,
  onTaskChange,
}: {
  userCfg: UserConfig | null;
  onTaskChange: (tc: TaskClass, patch: TaskModelPatch) => void;
}) {
  const catalog = useModelCatalog();
  const primaryTasks = TASK_CLASSES.slice(0, 3);
  const secondaryTasks = TASK_CLASSES.slice(3);
  return (
    <div className="settings-tab-content">
      {userCfg ? (
        <>
          <div className="task-group task-group--primary">
            <div className="settings-section-title">全域 provider / model 設定</div>
            <div className="settings-popover-task-grid">
              {primaryTasks.map((tc) => (
                <TaskModelRow
                  key={tc}
                  label={TASK_CLASS_LABELS[tc]}
                  hint={TASK_CLASS_HINTS[tc]}
                  provider={userCfg.defaults[tc].provider}
                  model={userCfg.defaults[tc].model}
                  effort={userCfg.defaults[tc].effort}
                  showProvider
                  models={catalog.models}
                  efforts={catalog.efforts}
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
              {secondaryTasks.map((tc) => (
                <TaskModelRow
                  key={tc}
                  label={TASK_CLASS_LABELS[tc]}
                  hint={TASK_CLASS_HINTS[tc]}
                  provider={userCfg.defaults[tc].provider}
                  model={userCfg.defaults[tc].model}
                  effort={userCfg.defaults[tc].effort}
                  models={catalog.models}
                  efforts={catalog.efforts}
                  onChange={(patch) => onTaskChange(tc, patch)}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="settings-subhint">載入中…</div>
      )}
    </div>
  );
}

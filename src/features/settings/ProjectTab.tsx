import { useEffect, useRef, useState } from "react";
import * as api from "../../api";
import { PickerSelect } from "../../ui/PickerSelect";
import { BranchIcon } from "../../ui/icons";
import { useToast } from "../../ui/Toast";
import { NumberField } from "../../ui/forms/NumberField";
import { SettingsField } from "./SettingsField";
import { isAbortError, useAutosaveFields } from "../../hooks/useAutosaveFields";
import "./SettingsPopover.css";

const BASE_BRANCH_FALLBACK = ["main", "master"];

const MIN = 1;
const MAX = 8;

type ProjectField = "max_parallel" | "default_base_branch" | "cost_limit_usd" | "auto_merge";
type AutosaveKey = `project:${ProjectField}`;

// sp-proj-r1-004 / 005:toast 與 field error 分工 —
//   field error = backend 回傳的具體理由(已經貼在欄位旁)
//   toast = 概括「<欄位> 未儲存」,避免和 field error 逐字重複
const FIELD_LABEL: Record<ProjectField, string> = {
  max_parallel: "平行上限",
  default_base_branch: "基礎分支",
  cost_limit_usd: "單次成本上限",
  auto_merge: "自動合併",
};
type ProjectConfirmedValues = {
  max_parallel: number;
  default_base_branch: string;
  cost_limit_usd: string;
  auto_merge: boolean;
};

export function ProjectTab({
  hash,
  onSaved,
  onSavedNotify,
  onLoadError,
}: {
  hash: string;
  onSaved?: (cfg: api.ProjectConfig) => void;
  onSavedNotify: () => void;
  onLoadError?: (message: string | null) => void;
}) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<api.ProjectConfig | null>(null);
  const [draftMaxParallel, setDraftMaxParallel] = useState<number>(2);
  const [draftBaseBranch, setDraftBaseBranch] = useState<string>("");
  const [draftCostLimit, setDraftCostLimit] = useState<string>("0");
  const [draftAutoMerge, setDraftAutoMerge] = useState<boolean>(false);
  const { scheduleAutosave, isCurrentSeq } = useAutosaveFields<AutosaveKey>();
  const savedProjectCfgRef = useRef<api.ProjectConfig | null>(null);
  const confirmedProjectValuesRef = useRef<ProjectConfirmedValues | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProjectField, string>>>({});
  const [savingFields, setSavingFields] = useState<Partial<Record<ProjectField, boolean>>>({});
  const [branches, setBranches] = useState<string[]>([]);
  const [basePickerOpen, setBasePickerOpen] = useState(false);

  function toastFieldSaveFailure(field: ProjectField, e: unknown) {
    if (isAbortError(e)) return;
    // sp-proj-r1-004:toast 用概括版「<欄位>未儲存」,避免和 inline field error 文案完全重複
    toast(`${FIELD_LABEL[field]}未儲存，請重試`, { variant: "danger" });
  }

  function setFieldSaving(field: ProjectField, v: boolean) {
    setSavingFields((s) => ({ ...s, [field]: v }));
  }
  function setFieldError(field: ProjectField, msg: string | null) {
    setFieldErrors((s) => {
      if (!msg) {
        const next = { ...s };
        delete next[field];
        return next;
      }
      return { ...s, [field]: msg };
    });
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
    setFieldError(field, null);
    setFieldSaving(field, true);
    scheduleAutosave(
      key,
      async (signal, seq) => {
        const next = await api.updateConfig(hash, patch, signal);
        if (!isCurrentSeq(key, seq)) return;
        const merged = mergeProjectSaved(field, next);
        savedProjectCfgRef.current = merged;
        updateConfirmedProjectValue(field, next);
        setCfg(merged);
        applyDisplay(next);
        setFieldSaving(field, false);
        onSaved?.(merged);
        onSavedNotify();
      },
      (e) => {
        // sp-proj-r1-005:field error 保留 backend 的具體理由(已經是可修正的訊息);
        // 只有在 backend 沒給訊息時才 fallback,避免把可修正的輸入錯誤誤導成系統錯誤。
        // sp-proj-r2-001:不再 rollback draft 回 confirmed — 保留 user 輸入的(已 clamped)值,
        // 讓 error 訊息與當下 visible value 對齊。User 改成合法值會自動重 schedule;
        // 切離 tab/popover 再回時 useEffect 會用 confirmed value 重新 init,不會 leak 髒狀態。
        const reason = e instanceof Error && e.message ? e.message : "儲存失敗，請重試";
        setFieldSaving(field, false);
        setFieldError(field, reason);
        toastFieldSaveFailure(field, e);
        // rollback() intentionally skipped — see comment above.
        void rollback;
      }
    );
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load on hash change only; local ref-writer + onLoadError prop callback intentionally excluded
  useEffect(() => {
    let cancelled = false;
    onLoadError?.(null);
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
        onLoadError?.(e.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  useEffect(() => {
    let cancelled = false;
    api
      .listBranches(hash)
      .then((list) => {
        if (cancelled) return;
        setBranches(list && list.length > 0 ? list : BASE_BRANCH_FALLBACK);
      })
      .catch(() => {
        if (cancelled) return;
        setBranches(BASE_BRANCH_FALLBACK);
      });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  return (
    <div className="settings-tab-content">
      <div className="task-group task-group--primary">
        <SettingsField
          label="平行上限"
          labelId="proj-max-parallel-label"
          saving={savingFields.max_parallel}
          error={fieldErrors.max_parallel}
          hint="達到上限後，新執行會排隊，前一個完成後自動開始。"
        >
          <NumberField
            label="平行上限"
            labelHidden
            min={MIN}
            max={MAX}
            step={1}
            value={draftMaxParallel}
            onChange={(v) => {
              const nextValue = v === "" ? MIN : v;
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
            inline
            fieldClassName="settings-form-field settings-form-field--narrow"
            inputClassName="mono"
          />
          <span className="mono settings-inline-unit">
            {MIN}–{MAX} 條
          </span>
        </SettingsField>

        <SettingsField
          label="基礎分支"
          htmlFor="proj-base-branch"
          saving={savingFields.default_base_branch}
          error={fieldErrors.default_base_branch}
          hint="新 pipeline 預設從此 branch 建立。"
        >
          <PickerSelect
            id="proj-base-branch"
            open={basePickerOpen}
            setOpen={setBasePickerOpen}
            value={draftBaseBranch}
            onChange={(next) => {
              setDraftBaseBranch(next);
              scheduleProjectSave(
                "default_base_branch",
                { defaults: { default_base_branch: next.trim() } },
                (saved) => applyProjectDisplay("default_base_branch", saved),
                () => {
                  const confirmedValue = confirmedProjectValuesRef.current?.default_base_branch;
                  if (confirmedValue !== undefined) setDraftBaseBranch(confirmedValue);
                }
              );
            }}
            icon={<span className="mono" style={{ color: "var(--fg-mute)", display: "inline-flex" }}><BranchIcon /></span>}
            options={(branches.length > 0 ? branches : BASE_BRANCH_FALLBACK).map((b) => ({ id: b, label: b, mono: true }))}
            disabled={!cfg}
            placeholder={cfg?.defaults.base_branch || "main"}
          />
        </SettingsField>

        <SettingsField
          label="單次成本上限"
          labelId="proj-cost-limit-label"
          saving={savingFields.cost_limit_usd}
          error={fieldErrors.cost_limit_usd}
          hint={
            <>
              <span className="settings-subhint-desktop">每條 pipeline 的成本上限,0 代表不限制。超過時只阻止該 pipeline 的下一次執行,不影響其他 pipeline。</span>
              <span className="settings-subhint-mobile">每條 pipeline 的上限,0 代表不限制。超過時只阻止下一次執行。</span>
            </>
          }
        >
          <NumberField
            label="單條 pipeline 成本上限"
            labelHidden
            min={0}
            step={0.01}
            value={draftCostLimit === "" ? "" : Number(draftCostLimit)}
            onChange={(v) => {
              const nextValue = v === "" ? "" : String(v);
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
            inline
            fieldClassName="settings-form-field settings-form-field--mid"
            inputClassName="mono"
          />
          <span className="mono settings-inline-unit">USD</span>
        </SettingsField>

        <SettingsField
          label="自動合併"
          tight
          saving={savingFields.auto_merge}
          error={fieldErrors.auto_merge}
          hint="每條 pipeline 仍可個別覆寫此設定。"
        >
          <label
            className={"toggle-pill" + (draftAutoMerge ? " is-on" : "")}
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
        </SettingsField>
      </div>
    </div>
  );
}

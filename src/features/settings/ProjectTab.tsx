import { useEffect, useRef, useState } from "react";
import * as api from "../../api/projects";
import { PickerSelect } from "../../ui/PickerSelect";
import { BranchIcon } from "../../ui/icons";
import { useToast } from "../../ui/Toast";
import "./SettingsPopover.css";

const BASE_BRANCH_FALLBACK = ["main", "master"];

const MIN = 1;
const MAX = 8;
const AUTOSAVE_DELAY_MS = 400;

type ProjectField = "max_parallel" | "default_base_branch" | "cost_limit_usd" | "auto_merge";
type AutosaveKey = `project:${ProjectField}`;
type ProjectConfirmedValues = {
  max_parallel: number;
  default_base_branch: string;
  cost_limit_usd: string;
  auto_merge: boolean;
};

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

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
  const timersRef = useRef<Partial<Record<AutosaveKey, ReturnType<typeof setTimeout>>>>({});
  const controllersRef = useRef<Partial<Record<AutosaveKey, AbortController>>>({});
  const seqRef = useRef<Partial<Record<AutosaveKey, number>>>({});
  const savedProjectCfgRef = useRef<api.ProjectConfig | null>(null);
  const confirmedProjectValuesRef = useRef<ProjectConfirmedValues | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProjectField, string>>>({});
  const [savingFields, setSavingFields] = useState<Partial<Record<ProjectField, boolean>>>({});
  const [branches, setBranches] = useState<string[]>([]);
  const [basePickerOpen, setBasePickerOpen] = useState(false);

  function toastSaveError(e: unknown) {
    if (isAbortError(e)) return;
    const message = e instanceof Error && e.message ? e.message : "儲存失敗，請重試";
    toast(message, { variant: "danger" });
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
    setFieldError(field, null);
    setFieldSaving(field, true);
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
        setFieldSaving(field, false);
        onSaved?.(merged);
        onSavedNotify();
      },
      (e) => {
        const msg = e instanceof Error && e.message ? e.message : "儲存失敗，請重試";
        setFieldSaving(field, false);
        setFieldError(field, msg);
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
    };
  }, []);

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
            {savingFields.max_parallel && (
              <span className="settings-field-status" aria-live="polite">儲存中…</span>
            )}
          </div>
        </div>
        {fieldErrors.max_parallel ? (
          <div className="settings-subhint settings-subhint--error" role="alert">
            {fieldErrors.max_parallel}
          </div>
        ) : (
          <div className="settings-subhint">達到上限後新 Run 排隊，前面跑完自動接棒。</div>
        )}

        <div className="settings-field-row">
          <label className="settings-field-label">基礎分支</label>
          <div className="settings-field-controls">
            <PickerSelect
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
              ariaLabel="預設基礎分支"
              placeholder={cfg?.defaults.base_branch || "main"}
            />
            {savingFields.default_base_branch && (
              <span className="settings-field-status" aria-live="polite">儲存中…</span>
            )}
          </div>
        </div>
        {fieldErrors.default_base_branch ? (
          <div className="settings-subhint settings-subhint--error" role="alert">
            {fieldErrors.default_base_branch}
          </div>
        ) : (
          <div className="settings-subhint">新 pipeline 預設從這個 branch 切。</div>
        )}

        <div className="settings-field-row">
          <label className="settings-field-label">單條 pipeline 成本上限</label>
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
            <span className="mono settings-inline-unit">USD（0 = 不限制）</span>
            {savingFields.cost_limit_usd && (
              <span className="settings-field-status" aria-live="polite">儲存中…</span>
            )}
          </div>
        </div>
        {fieldErrors.cost_limit_usd ? (
          <div className="settings-subhint settings-subhint--error" role="alert">
            {fieldErrors.cost_limit_usd}
          </div>
        ) : (
          <>
            <div className="settings-subhint settings-subhint-desktop">每條 pipeline 個別累積上限，超過時只擋該 pipeline 的下次 /run，不影響其他 pipeline。</div>
            <div className="settings-subhint settings-subhint-mobile">超過上限時，只擋該 pipeline 的下次 /run。</div>
          </>
        )}

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
          {savingFields.auto_merge && (
            <span className="settings-field-status" aria-live="polite">儲存中…</span>
          )}
        </div>
        {fieldErrors.auto_merge ? (
          <div className="settings-subhint settings-subhint--error" role="alert">
            {fieldErrors.auto_merge}
          </div>
        ) : (
          <div className="settings-subhint">每條 pipeline 也可單獨切換。</div>
        )}
      </div>
    </div>
  );
}

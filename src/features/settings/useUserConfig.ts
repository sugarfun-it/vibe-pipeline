import { useEffect, useRef, useState } from "react";
import * as userConfigApi from "../../api/userConfig";
import {
  TASK_CLASSES,
  defaultEffortForProvider,
  defaultModelForProvider,
  isValidEffort,
  isValidModel,
  type Effort,
  type ModelName,
  type Provider,
  type PushEventKey,
  type TaskClass,
  type UserConfig,
} from "../../../shared/types";

const AUTOSAVE_DELAY_MS = 400;

type TaskModelPatch = { provider?: Provider; model?: ModelName; effort?: Effort };
type TaskField = "provider" | "model" | "effort";
type AutosaveKey = `task:${TaskClass}:${TaskField}`;
type TaskConfirmedValue = Provider | ModelName | Effort;
type TaskConfirmedValues = Partial<Record<`task:${TaskClass}:${TaskField}`, TaskConfirmedValue>>;

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

export function useUserConfig({
  open,
  onSaved,
  onSaveError,
}: {
  open: boolean;
  onSaved: () => void;
  onSaveError: (e: unknown) => void;
}) {
  const [userCfg, setUserCfg] = useState<UserConfig | null>(null);
  const [userCfgError, setUserCfgError] = useState<string | null>(null);
  const [pushSaving, setPushSaving] = useState<Partial<Record<PushEventKey, boolean>>>({});
  const timersRef = useRef<Partial<Record<AutosaveKey, ReturnType<typeof setTimeout>>>>({});
  const controllersRef = useRef<Partial<Record<AutosaveKey, AbortController>>>({});
  const seqRef = useRef<Partial<Record<AutosaveKey, number>>>({});
  const savedUserCfgRef = useRef<UserConfig | null>(null);
  const confirmedTaskValuesRef = useRef<TaskConfirmedValues>({});

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

  function scheduleTaskSave(tc: TaskClass, field: TaskField, patch: TaskModelPatch, rollback: () => void) {
    const key: AutosaveKey = `task:${tc}:${field}`;
    scheduleAutosave(
      key,
      async (signal, seq) => {
        const fresh = await userConfigApi.updateUserConfig({ defaults: { [tc]: patch } }, signal);
        if (seqRef.current[key] !== seq) return;
        savedUserCfgRef.current = fresh;
        setUserCfg(fresh);
        setConfirmedTaskValues(fresh);
        onSaved();
      },
      (e) => {
        onSaveError(e);
        rollback();
      }
    );
  }

  useEffect(() => {
    const timers = timersRef.current;
    const controllers = controllersRef.current;
    return () => {
      for (const timer of Object.values(timers)) {
        if (timer) clearTimeout(timer);
      }
      for (const controller of Object.values(controllers)) {
        controller?.abort();
      }
    };
  }, []);

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
      defaults: { ...userCfg.defaults, [tc]: merged },
    };
    setUserCfg(next);
    setUserCfgError(null);
    scheduleTaskSave(tc, field, sendPatch, () => {
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
          defaults: { ...current.defaults, [tc]: rolledBackTask },
        };
      });
    });
  }

  function updatePushEvent(key: PushEventKey, enabled: boolean) {
    if (!userCfg) return;
    const prev = userCfg.pushEvents[key];
    const next: UserConfig = {
      ...userCfg,
      pushEvents: { ...userCfg.pushEvents, [key]: enabled },
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
        onSaved();
      })
      .catch((e: unknown) => {
        onSaveError(e);
        setUserCfg((current) => {
          if (!current) return current;
          return {
            ...current,
            pushEvents: { ...current.pushEvents, [key]: prev },
          };
        });
      })
      .finally(() => {
        setPushSaving((current) => ({ ...current, [key]: false }));
      });
  }

  return { userCfg, userCfgError, pushSaving, updateTask, updatePushEvent };
}

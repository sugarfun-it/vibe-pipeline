import { useEffect, useRef, useState } from "react";
import * as userConfigApi from "../../api/userConfig";
import {
  TASK_CLASSES,
  PROVIDERS,
  type Effort,
  type ModelName,
  type Provider,
  type PushEventKey,
  type TaskClass,
  type UserConfig,
} from "../../../shared/types";
import { useToast } from "../../ui/Toast";
import { useAutosaveFields } from "../../hooks/useAutosaveFields";
import { useModelCatalog } from "./useModelCatalog";

type TaskModelPatch = { provider?: Provider; model?: ModelName; effort?: Effort };
type TaskField = "provider" | "model" | "effort";
type AutosaveKey = `task:${TaskClass}:${TaskField}`;
type TaskConfirmedValue = Provider | ModelName | Effort;
type TaskConfirmedValues = Partial<Record<`task:${TaskClass}:${TaskField}`, TaskConfirmedValue>>;

export function useUserConfig({
  open,
  onSaved,
  onSaveError,
}: {
  open: boolean;
  onSaved: () => void;
  onSaveError: (e: unknown) => void;
}) {
  const { toast } = useToast();
  const catalog = useModelCatalog();
  const [userCfg, setUserCfg] = useState<UserConfig | null>(null);
  const [pushSaving, setPushSaving] = useState<Partial<Record<PushEventKey, boolean>>>({});
  const { scheduleAutosave, isCurrentSeq } = useAutosaveFields<AutosaveKey>();
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
    // model / effort 皆為 string,直接賦值;provider 是窄 union,runtime guard 收斂
    if (field === "model") return { ...task, model: value };
    if (field === "effort") return { ...task, effort: value };
    return PROVIDERS.includes(value as Provider) ? { ...task, provider: value as Provider } : task;
  }

  function scheduleTaskSave(tc: TaskClass, field: TaskField, patch: TaskModelPatch, rollback: () => void) {
    const key: AutosaveKey = `task:${tc}:${field}`;
    scheduleAutosave(
      key,
      async (signal, seq) => {
        const fresh = await userConfigApi.updateUserConfig({ defaults: { [tc]: patch } }, signal);
        if (!isCurrentSeq(key, seq)) return;
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: local ref-writer, intentionally excluded
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    userConfigApi
      .getUserConfig()
      .then((c) => {
        if (cancelled) return;
        savedUserCfgRef.current = c;
        setConfirmedTaskValues(c);
        setUserCfg(c);
      })
      .catch((e: Error) => {
        if (!cancelled) toast(`讀取使用者設定失敗:${e.message}`, { variant: "danger" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, toast]);

  function updateTask(tc: TaskClass, patch: TaskModelPatch) {
    if (!userCfg) return;
    const cur = userCfg.defaults[tc];
    const field: TaskField =
      patch.provider !== undefined ? "provider" : patch.model !== undefined ? "model" : "effort";
    let sendPatch = patch;
    const merged = { ...cur, ...patch };
    if (patch.provider && patch.provider !== cur.provider) {
      const np = patch.provider;
      if (patch.model === undefined && !catalog.models(np).includes(merged.model)) {
        merged.model = catalog.models(np)[0] as ModelName;
        sendPatch = { ...sendPatch, model: merged.model };
      }
      if (patch.effort === undefined && !catalog.efforts(np).includes(merged.effort)) {
        merged.effort = catalog.efforts(np)[0] as Effort;
        sendPatch = { ...sendPatch, effort: merged.effort };
      }
    }
    const next: UserConfig = {
      ...userCfg,
      defaults: { ...userCfg.defaults, [tc]: merged },
    };
    setUserCfg(next);
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

  return { userCfg, pushSaving, updateTask, updatePushEvent };
}

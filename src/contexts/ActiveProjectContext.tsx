import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Project } from "../../shared/types";

export type NotifyOpts = { sub?: string; pipelineId?: string };

export type ActiveProjectContextValue = {
  hash: string | null;
  project: Project | null;
  setProject: (next: Project | null) => void;
  reloadKey: number;
  bumpReload: () => void;
  notifyError: (msg: string, opts?: NotifyOpts) => void;
  notifyWarn: (msg: string, opts?: NotifyOpts) => void;
  notifyInfo: (msg: string, opts?: NotifyOpts) => void;
};

const Ctx = createContext<ActiveProjectContextValue | null>(null);

export function ActiveProjectProvider({
  value,
  children,
}: {
  value: ActiveProjectContextValue;
  children: ReactNode;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: memoize context object by individual fields; intentionally not depending on the whole value object
  const memo = useMemo(() => value, [
    value.hash,
    value.project,
    value.reloadKey,
    value.setProject,
    value.bumpReload,
    value.notifyError,
    value.notifyWarn,
    value.notifyInfo,
  ]);
  return <Ctx.Provider value={memo}>{children}</Ctx.Provider>;
}

export function useActiveProjectContext(): ActiveProjectContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveProjectContext 要在 ActiveProjectProvider 內用");
  return v;
}

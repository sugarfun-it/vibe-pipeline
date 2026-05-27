import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { useTimeout } from "../../../hooks/useTimeout";
import type { Pipeline, Project } from "../../../../shared/types";

export function usePipelinesState({
  hash,
  project,
  setProject,
  setActiveId,
  setPopupDismissed,
}: {
  hash: string | null;
  project: Project | null;
  setProject: (project: Project | null) => void;
  setActiveId: (next: string | ((prev: string) => string)) => void;
  setPopupDismissed: (next: boolean) => void;
}) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [tick, setTick] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useTimeout(() => setActionError(null), actionError ? 6000 : null, [actionError]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hash is the intentional trigger
  const prevHashRef = useRef<string | null>(null);
  useEffect(() => {
    setPopupDismissed(false);
    setActionError(null);
    if (prevHashRef.current !== null && prevHashRef.current !== hash) {
      setActiveId("");
      setPipelines([]);
    }
    prevHashRef.current = hash ?? null;
  }, [hash]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a force-refetch trigger
  useEffect(() => {
    if (!hash) {
      setProject(null);
      setPipelines([]);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    api
      .status(hash)
      .then((p) => {
        if (cancelled) return;
        setProject(p);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hash, reloadKey]);

  const pipelinesResult = useApi<{ projectHash: string; pipelines: Pipeline[] } | null>(
    async () => {
      if (!project?.hasInit) return null;
      const projectHash = project.hash;
      const arr = await api.listPipelines(projectHash);
      const tsOf = (p: Pipeline): number => {
        if (typeof p.createdAt === "number") return p.createdAt;
        const tsHex = (p.id ?? "").split("-")[0];
        return tsHex && /^[0-9a-f]+$/i.test(tsHex) ? parseInt(tsHex, 16) : 0;
      };
      const sorted = [...((arr as Pipeline[]) ?? [])].sort((a, b) => tsOf(b) - tsOf(a));
      return { projectHash, pipelines: sorted };
    },
    {
      intervalMs: 5000,
      gate: !!project?.hasInit,
      deps: [project?.hash, project?.hasInit, reloadKey],
      cacheKey: hash ? `pipelines:${hash}` : undefined,
    }
  );
  useEffect(() => {
    if (!project?.hasInit || project.hash !== hash) {
      setPipelines([]);
      return;
    }
    const result = pipelinesResult.data;
    if (result?.projectHash === project.hash) {
      const sorted = result.pipelines;
      setPipelines(sorted);
      if (sorted.length > 0) setActiveId((id) => id || sorted[0].id);
    }
  }, [hash, project, pipelinesResult.data]);

  return {
    loadError,
    actionError,
    setActionError,
    pipelines,
    setPipelines,
    tick,
    reloadKey,
    bumpReload,
  };
}

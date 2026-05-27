import { useCallback, useEffect, useState } from "react";
import * as api from "../../../api";
import { useApi } from "../../../hooks/useApi";
import type { Project } from "../../../../shared/types";

export function useProjectMeta({
  creating,
  project,
  reloadKey,
}: {
  creating: boolean;
  project: Project | null;
  reloadKey: number;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [maxParallel, setMaxParallel] = useState<number>(0);
  const [defaultAutoMerge, setDefaultAutoMerge] = useState<boolean>(false);

  useEffect(() => {
    if (!creating || !project?.hasGit) {
      return;
    }
    api
      .listBranches(project.hash)
      .then((bs) => setBranches(bs))
      .catch(() => setBranches([]));
  }, [creating, project?.hash, project?.hasGit]);

  const configResult = useApi(
    async () => (project?.hasInit ? await api.getConfig(project.hash) : null),
    { deps: [project?.hash, project?.hasInit, reloadKey] }
  );
  useEffect(() => {
    if (!project?.hasInit) {
      setMaxParallel(0);
      return;
    }
    if (configResult.data) {
      setMaxParallel(configResult.data.defaults.max_parallel);
      setDefaultAutoMerge(!!configResult.data.defaults.auto_merge);
    }
  }, [project, configResult.data]);

  const handleConfigSaved = useCallback(
    (cfg: { defaults: { max_parallel: number; auto_merge?: boolean } }) => {
      setMaxParallel(cfg.defaults.max_parallel);
      setDefaultAutoMerge(!!cfg.defaults.auto_merge);
    },
    [],
  );

  return {
    branches,
    maxParallel,
    defaultAutoMerge,
    handleConfigSaved,
  };
}

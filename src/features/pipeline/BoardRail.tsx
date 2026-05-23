import { Rail } from "../../shell/Rail";
import type { RailMenuItem } from "../../shell/Rail";
import { TrashIcon } from "../../ui/icons";
import { useConfirm } from "../../ui/ConfirmDialog";
import { CreateCard } from "../pipelineCreate/CreateCard";
import * as api from "../../api/projects";
import type { Pipeline } from "../../types/pipeline";
import type { Project } from "../../../shared/types";
import { useActiveProjectContext } from "../../contexts/ActiveProjectContext";

export function BoardRail({
  project,
  pipelines,
  activeId,
  onSelect,
  creating,
  setCreating,
  isUninit,
  onStartInit,
  draftPipelineIds,
  branches,
  defaultAutoMerge,
  onCreate,
}: {
  project: Project | null;
  pipelines: Pipeline[];
  activeId: string;
  onSelect: (id: string) => void;
  creating: boolean;
  setCreating: (v: boolean) => void;
  isUninit: boolean;
  onStartInit: () => void;
  draftPipelineIds: Set<string>;
  branches: string[];
  defaultAutoMerge: boolean;
  onCreate: (args: { name: string; baseBranch: string; autoMerge: boolean }) => void;
}) {
  const { notifyError, notifyInfo } = useActiveProjectContext();
  const confirmDialog = useConfirm();

  async function handleCleanupAllMergedWorktrees() {
    if (!project) return;
    const mergedPipelines = pipelines.filter((p) => p.state === "merged");
    const n = mergedPipelines.length;
    if (n === 0) {
      notifyInfo("目前沒有已合併的 pipeline,無需清除");
      return;
    }
    const okay = await confirmDialog({
      title: `清除所有已合併的 worktree?`,
      description:
        `將清除目前 project 內所有 state=merged 的 pipeline worktree(共 ${n} 個):\n` +
        mergedPipelines.map((p) => `  · ${p.name}`).join("\n") +
        "\n\n只清磁碟,pipeline 紀錄 / branch 不動。",
      confirmLabel: `清除 ${n} 個`,
    });
    if (!okay) return;
    try {
      const r = await api.cleanupMergedWorktrees(project.hash);
      const cleanedN = r.cleaned.length;
      const skippedN = r.skipped_not_merged.length;
      const failedN = r.failed.length;
      const parts: string[] = [];
      parts.push(`清除 ${cleanedN} 個 worktree`);
      if (skippedN > 0) parts.push(`跳過 ${skippedN} 個(未合併)`);
      if (failedN > 0) parts.push(`失敗 ${failedN} 個`);
      const msg = parts.join(",");
      if (failedN > 0) {
        notifyError(`⚠ ${msg}`);
      } else {
        notifyInfo(`✓ ${msg}`);
      }
    } catch (e) {
      notifyError(`清除 worktree 失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const sectionMenuItems: RailMenuItem[] = [
    {
      key: "cleanup-all-merged-worktrees",
      label: "清除已合併 worktree",
      icon: <TrashIcon />,
      onClick: () => {
        void handleCleanupAllMergedWorktrees();
      },
    },
  ];

  return (
    <Rail
      pipelines={pipelines}
      activeId={activeId}
      onSelect={onSelect}
      creating={creating}
      onStartCreate={isUninit ? onStartInit : () => setCreating(true)}
      addLabel={isUninit ? "開始初始化" : "新 pipeline"}
      draftPipelineIds={draftPipelineIds}
      sectionMenuItems={sectionMenuItems}
      createSlot={
        <CreateCard
          onCancel={() => setCreating(false)}
          onSubmit={onCreate}
          existingNames={pipelines.map((p) => p.name)}
          branches={branches}
          defaultAutoMerge={defaultAutoMerge}
        />
      }
    />
  );
}

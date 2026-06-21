import { memo, useMemo } from "react";
import { Rail } from "../../../shell/Rail";
import type { RailMenuItem } from "../../../shell/Rail";
import { TrashIcon } from "../../../ui/icons";
import { useConfirm } from "../../../ui/ConfirmDialog";
import { CreateCard } from "../misc/CreateCard";
import * as api from "../../../api";
import type { Pipeline } from "../../../../shared/types";
import type { Project } from "../../../../shared/types";
import { useActiveProjectContext } from "../../../contexts/ActiveProjectContext";

export const BoardRail = memo(function BoardRail({
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
  const existingNames = useMemo(() => pipelines.map((p) => p.name), [pipelines]);

  async function handleDeleteAllMergedPipelines() {
    if (!project) return;
    const mergedPipelines = pipelines.filter((p) => p.state === "merged");
    const n = mergedPipelines.length;
    if (n === 0) {
      notifyInfo("目前沒有已合併的 pipeline");
      return;
    }
    const okay = await confirmDialog({
      title: `刪除所有已合併的 pipeline?`,
      description:
        `將刪除目前 project 內所有 state=merged 的 pipeline(共 ${n} 個):\n` +
        mergedPipelines.map((p) => `  · ${p.name}`).join("\n") +
        "\n\n連 worktree + branch + 紀錄一起刪。程式碼已在 base、刪除安全;但 VP 側的 spec / QA / iter 歷史會一起消失。執行中的會跳過。",
      confirmLabel: `刪除 ${n} 個`,
    });
    if (!okay) return;
    try {
      const r = await api.deleteMergedPipelines(project.hash);
      const deletedN = r.deleted.length + r.partial.length;
      const parts: string[] = [`刪除 ${deletedN} 個 pipeline`];
      if (r.partial.length > 0) parts.push(`${r.partial.length} 個 worktree/branch 殘留待清`);
      if (r.skipped_active.length > 0) parts.push(`跳過 ${r.skipped_active.length} 個(執行中)`);
      if (r.failed.length > 0) parts.push(`失敗 ${r.failed.length} 個`);
      const msg = parts.join(",");
      if (r.failed.length > 0) {
        notifyError(`⚠ ${msg}`);
      } else {
        notifyInfo(`✓ ${msg}`);
      }
    } catch (e) {
      notifyError(`刪除已合併 pipeline 失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const mergedCount = pipelines.filter((p) => p.state === "merged").length;
  const sectionMenuItems: RailMenuItem[] = [
    {
      key: "delete-all-merged-pipelines",
      // 全刪語意(worktree + branch + 紀錄),維持 danger 樣式 + confirm dialog。
      label: "刪除已合併 pipeline",
      icon: <TrashIcon />,
      danger: true,
      // hint 顯示在 menuitem 末段(focus-overflow-item-hint 會 ellipsis),短句不卡版面
      disabledReason: mergedCount === 0 ? "目前無已合併" : undefined,
      onClick: () => {
        void handleDeleteAllMergedPipelines();
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
          existingNames={existingNames}
          branches={branches}
          defaultAutoMerge={defaultAutoMerge}
        />
      }
    />
  );
});

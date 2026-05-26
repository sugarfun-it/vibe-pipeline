import { memo, useMemo } from "react";
import { CreatePlaceholder } from "./CreateCard";
import { EmptyProject } from "./EmptyProject";
import { FocusColumn } from "./FocusColumn";
import * as api from "../../api";
import type { Pipeline, Ticket } from "../../../shared/types";
import type { Project } from "../../../shared/types";
import { useActiveProjectContext } from "../../contexts/ActiveProjectContext";

export const BoardMain = memo(function BoardMain({
  project,
  pipelines,
  setPipelines,
  active,
  activeId,
  setActiveId,
  creating,
  tick,
  queuePosition,
  splittingTicketId,
  qaOpen,
  qaDraftFor,
  onTicketClick,
}: {
  project: Project;
  pipelines: Pipeline[];
  setPipelines: React.Dispatch<React.SetStateAction<Pipeline[]>>;
  active: Pipeline | undefined;
  activeId: string;
  setActiveId: (next: string | ((prev: string) => string)) => void;
  creating: boolean;
  tick: number;
  queuePosition: number;
  splittingTicketId: string | null;
  qaOpen: (pipelineId: string) => void;
  qaDraftFor: (pipelineId: string) => unknown;
  onTicketClick: (t: Ticket) => void;
}) {
  const { reloadKey, bumpReload, notifyError, notifyWarn, notifyInfo } = useActiveProjectContext();
  const isUninit = !project.hasInit;
  const existingNames = useMemo(() => pipelines.map((p) => p.name), [pipelines]);

  if (creating) return <CreatePlaceholder />;
  if (isUninit) {
    return (
      <EmptyProject
        message="這個專案還沒初始化"
        hint="點左邊「開始初始化」打開引導,或在上方專案切換器選其他資料夾。"
        pointToTopBar={false}
      />
    );
  }
  if (pipelines.length === 0) {
    return (
      <EmptyProject
        message="還沒任何 pipeline"
        hint="點左邊「+ 新 pipeline」建立第一條。"
        pointToTopBar={false}
      />
    );
  }
  if (!active) {
    return <EmptyProject message="載入中…" hint="" pointToTopBar={false} />;
  }
  return (
    <FocusColumn
      pipeline={active}
      tick={tick}
      projectHash={project.hash}
      reloadKey={reloadKey}
      queuePosition={queuePosition}
      splittingTicketId={splittingTicketId}
      onAddTicket={(pid) => qaOpen(pid)}
      hasActiveDraft={!!qaDraftFor(active.id)}
      onTicketClick={onTicketClick}
      onRun={async (pid) => {
        try {
          await api.runPipeline(project.hash, pid);
          bumpReload();
          notifyInfo("✓ pipeline 已啟動,runner 接手中…", { pipelineId: pid });
        } catch (e) {
          notifyError(`開始運行失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onStop={async (pid) => {
        try {
          await api.pausePipeline(project.hash, pid);
          bumpReload();
          notifyInfo("✓ 已停止 pipeline", { pipelineId: pid });
        } catch (e) {
          notifyError(`停止失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onDelete={async (pid) => {
        const targetName = pipelines.find((p) => p.id === pid)?.name ?? pid;
        try {
          await api.deletePipeline(project.hash, pid);
          setPipelines((arr) => {
            const next = arr.filter((p) => p.id !== pid);
            if (pid === activeId) setActiveId(next[0]?.id ?? "");
            return next;
          });
          notifyInfo(`✓ pipeline "${targetName}" 已刪除`, { pipelineId: pid });
        } catch (e) {
          notifyError(`刪除失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onRename={async (pid, newName) => {
        const target = pipelines.find((p) => p.id === pid);
        if (!target) return;
        const next: Pipeline = { ...target, name: newName };
        try {
          await api.savePipeline(project.hash, pid, next);
          setPipelines((arr) => arr.map((p) => (p.id === pid ? next : p)));
          notifyInfo(`✓ 已改名為 "${newName}"`, { pipelineId: pid });
        } catch (e) {
          notifyError(`改名失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onResetPipeline={async (pid) => {
        try {
          await api.resetPipeline(project.hash, pid);
          bumpReload();
          notifyInfo("✓ pipeline 已重置(worktree + branch 全清,tickets 回 draft)", {
            pipelineId: pid,
          });
        } catch (e) {
          notifyError(`重置失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      existingNames={existingNames}
      onRevealWorktree={async (pid) => {
        try {
          await api.revealWorktree(project.hash, pid);
        } catch (e) {
          notifyError(`開啟 worktree 失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onMerge={async (pid) => {
        try {
          const r = await api.mergePipeline(project.hash, pid);
          bumpReload();
          if (r.mode === "mechanical") {
            notifyInfo(r.alreadyMerged ? "✓ 已合併過" : `✓ 合併完成(純 git,無 AI)`, {
              pipelineId: pid,
            });
          } else {
            const n = r.conflictFiles?.length ?? 0;
            notifyWarn(`⚠ 撞 ${n} 衝突檔,AI 開始解中(約 2 分鐘)…`, { pipelineId: pid });
          }
        } catch (e) {
          notifyError(`觸發合併失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onSync={async (pid) => {
        try {
          const r = await api.syncPipeline(project.hash, pid);
          bumpReload();
          if (r.state === "done") {
            notifyInfo(
              r.behind && r.behind > 0
                ? "✓ 同步完成(git merge 直接成功,無需 AI)"
                : "✓ worktree 已是最新,無需同步",
              { pipelineId: pid }
            );
          } else if (r.state === "conflict_await") {
            notifyWarn(
              `⚠ git merge 撞到 ${r.conflictFiles?.length ?? 0} 個衝突,modal 已跳出等決定`,
              { pipelineId: pid }
            );
          } else if (r.state === "failed") {
            notifyError("✕ 同步失敗,看 pipeline 上的提示", { pipelineId: pid });
          } else {
            notifyInfo("同步啟動中…", { pipelineId: pid });
          }
        } catch (e) {
          notifyError(`觸發同步失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onSyncConfirmAi={async (pid) => {
        try {
          await api.syncConfirmAi(project.hash, pid);
          bumpReload();
          notifyInfo("✓ AI 解衝突已啟動", { pipelineId: pid });
        } catch (e) {
          notifyError(
            `啟動 AI 解衝突失敗: ${e instanceof Error ? e.message : String(e)}`,
            { pipelineId: pid }
          );
        }
      }}
      onSyncCancel={async (pid) => {
        try {
          await api.syncCancel(project.hash, pid);
          bumpReload();
          notifyInfo("✓ 已取消同步,worktree 已回原狀", { pipelineId: pid });
        } catch (e) {
          notifyError(`取消同步失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onSyncDismiss={async (pid) => {
        try {
          await api.syncDismiss(project.hash, pid);
          bumpReload();
        } catch (e) {
          notifyError(`清掉同步狀態失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
      onToggleAutoMerge={async (pid, nextValue) => {
        const target = pipelines.find((p) => p.id === pid);
        if (!target) return;
        const next: Pipeline = { ...target, autoMerge: nextValue };
        setPipelines((arr) => arr.map((p) => (p.id === pid ? next : p)));
        try {
          await api.savePipeline(project.hash, pid, next);
          notifyInfo(
            nextValue ? "✓ 已啟用自動合併" : "✓ 已關閉自動合併",
            { pipelineId: pid }
          );
        } catch (e) {
          setPipelines((arr) => arr.map((p) => (p.id === pid ? target : p)));
          notifyError(`切換自動合併失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: pid,
          });
        }
      }}
    />
  );
});

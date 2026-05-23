import { memo } from "react";
import { InitPopup } from "../init/InitPopup";
import { QADrawer } from "../qa/QADrawer";
import { TicketDrawer } from "./TicketDrawer";
import * as api from "../../api/projects";
import * as qaApi from "../../api/qa";
import type { Pipeline, Ticket } from "../../types/pipeline";
import type { Project } from "../../../shared/types";
import { useActiveProjectContext } from "../../contexts/ActiveProjectContext";

type QaLike = {
  state: {
    open: boolean;
    pipelineId: string | null;
    draft?: any;
    busy?: boolean;
  };
  sendTurn: (...args: any[]) => any;
  cancel: (...args: any[]) => any;
  close: (...args: any[]) => any;
  finalize: (edits: any, splitInto: any) => Promise<unknown>;
};

export const BoardOverlays = memo(function BoardOverlays({
  project,
  pipelines,
  setPipelines,
  active,
  qa,
  openTicket,
  setOpenTicket,
  splittingTicketId,
  setSplittingTicketId,
  popupDismissed,
  setPopupDismissed,
  actionError,
  setActionError,
}: {
  project: Project;
  pipelines: Pipeline[];
  setPipelines: React.Dispatch<React.SetStateAction<Pipeline[]>>;
  active: Pipeline | undefined;
  qa: QaLike;
  openTicket: Ticket | null;
  setOpenTicket: (t: Ticket | null) => void;
  splittingTicketId: string | null;
  setSplittingTicketId: (id: string | null) => void;
  popupDismissed: boolean;
  setPopupDismissed: (v: boolean) => void;
  actionError: string | null;
  setActionError: (msg: string | null) => void;
}) {
  const { setProject, bumpReload, notifyError, notifyWarn, notifyInfo } = useActiveProjectContext();

  const initOverlay = !project.hasInit && !popupDismissed ? (
    <InitPopup
      project={project}
      onInitialized={(next) => {
        setProject(next);
        bumpReload();
      }}
      onDismiss={() => setPopupDismissed(true)}
    />
  ) : null;

  const qaOverlay = qa.state.open && qa.state.pipelineId ? (
    <QADrawer
      pipelineName={
        pipelines.find((p) => p.id === qa.state.pipelineId)?.name ?? qa.state.pipelineId
      }
      draft={qa.state.draft}
      busy={!!qa.state.busy}
      onSendTurn={qa.sendTurn}
      onCancel={qa.cancel}
      onClose={qa.close}
      onFinalize={async (edits: any, splitInto: any) => {
        try {
          const result = (await qa.finalize(edits, splitInto)) as
            | { pipeline: Pipeline; tickets: Array<{ id: string }>; splitCount: number }
            | null;
          if (result) {
            setPipelines((arr) =>
              arr.map((p) => (p.id === result.pipeline.id ? result.pipeline : p))
            );
            notifyInfo(
              result.splitCount > 1
                ? `✓ 已建立 ${result.splitCount} 張 ticket`
                : "✓ ticket 已建立",
              { pipelineId: result.pipeline.id }
            );
          }
        } catch (e) {
          notifyError(`送出 ticket 失敗: ${e instanceof Error ? e.message : String(e)}`);
        }
      }}
    />
  ) : null;

  const liveTicket = openTicket && active
    ? active.tickets.find((t) => t.id === openTicket.id) ?? openTicket
    : null;

  const ticketOverlay = liveTicket && active ? (
    <TicketDrawer
      ticket={liveTicket}
      pipelineName={active.name}
      pipelineBranch={active.branch}
      pipelineId={active.id}
      projectHash={project.hash}
      onClose={() => setOpenTicket(null)}
      onResetTicket={async (ticketId) => {
        if (!active) return;
        const next: Pipeline = {
          ...active,
          state: "planning",
          tickets: active.tickets.map((t) => {
            if (t.id !== ticketId) return t;
            const { iter: _i, commits: _c, liveLog: _l, reason: _r, ...rest } = t;
            void _i; void _c; void _l; void _r;
            return { ...rest, status: "draft" };
          }),
        };
        try {
          await api.savePipeline(project.hash, active.id, next);
          bumpReload();
          notifyInfo("✓ ticket 已重置回 draft", { pipelineId: active.id });
        } catch (e) {
          notifyError(`重置 ticket 失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        }
      }}
      isSplitting={splittingTicketId === openTicket?.id}
      onSplitTicket={async (ticketId) => {
        if (!active) return;
        setSplittingTicketId(ticketId);
        try {
          const r = await qaApi.splitTicket(project.hash, active.id, ticketId);
          if ("nothingToSplit" in r) {
            notifyInfo("✓ AI 認為這張 ticket 不需拆", { pipelineId: active.id });
          } else {
            notifyInfo(`✓ 已拆成 ${r.count} 張 ticket`, { pipelineId: active.id });
            setOpenTicket(null);
          }
          bumpReload();
        } catch (e) {
          notifyError(`AI 拆分失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        } finally {
          setSplittingTicketId(null);
        }
      }}
      onDeleteTicket={async (ticketId) => {
        if (!active) return;
        try {
          await qaApi.deleteTicket(project.hash, active.id, ticketId);
          setOpenTicket(null);
          bumpReload();
          notifyInfo("✓ ticket 已刪除", { pipelineId: active.id });
        } catch (e) {
          notifyError(`刪除 ticket 失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        }
      }}
      onToggleMode={async (ticketId, nextMode) => {
        if (!active) return;
        const next: Pipeline = {
          ...active,
          tickets: active.tickets.map((t) =>
            t.id === ticketId ? { ...t, mode: nextMode } : t
          ),
        };
        try {
          await api.savePipeline(project.hash, active.id, next);
          bumpReload();
        } catch (e) {
          notifyError(`切換 mode 失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        }
      }}
      onChangeIterLimit={async (ticketId, limit) => {
        if (!active) return;
        const next: Pipeline = {
          ...active,
          tickets: active.tickets.map((t) =>
            t.id === ticketId ? { ...t, iterLimit: limit } : t
          ),
        };
        try {
          await api.savePipeline(project.hash, active.id, next);
          bumpReload();
        } catch (e) {
          notifyError(`改 iter 上限失敗: ${e instanceof Error ? e.message : String(e)}`, {
            pipelineId: active.id,
          });
        }
      }}
    />
  ) : null;

  const actionToast = actionError ? (
    <div role="alert" className="action-toast">
      <span className="action-toast-msg">{actionError}</span>
      <button type="button"
        className="action-toast-close"
        onClick={() => setActionError(null)}
        title="關閉"
        aria-label="關閉"
      >
        ×
      </button>
    </div>
  ) : null;

  // Suppress unused warning for notifyWarn (kept in case caller wants symmetry)
  void notifyWarn;

  return (
    <>
      {initOverlay}
      {qaOverlay}
      {ticketOverlay}
      {actionToast}
    </>
  );
});

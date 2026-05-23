import { useCallback, useEffect, useState } from "react";
import * as qaApi from "../../api/qa";
import type { Draft, TicketSpec } from "../../api/qa";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../ui/Toast";

export type QAState = {
  open: boolean;
  pipelineId: string | null;
  draft: Draft | null;
  busy: boolean;
};

const INITIAL: QAState = {
  open: false,
  pipelineId: null,
  draft: null,
  busy: false,
};

export function useQA(projectHash: string | null) {
  const { toast } = useToast();
  const [state, setState] = useState<QAState>(INITIAL);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const toastErr = useCallback((prefix: string, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    toast(`${prefix}:${msg}`, { variant: "danger" });
  }, [toast]);

  const refreshDrafts = useCallback(async () => {
    if (!projectHash) {
      setDrafts([]);
      return;
    }
    try {
      const list = await qaApi.listDrafts(projectHash);
      setDrafts(list);
    } catch {
      setDrafts([]);
    }
  }, [projectHash]);

  useEffect(() => {
    refreshDrafts();
  }, [refreshDrafts]);

  // 接續 QA 時:若 draft 最後一條是 user message(代表 AI 還在 backend 跑或沒回完),
  // poll getDraft 等 AI 寫進 disk;同時讓 UI 顯「AI 思考中」(由 derived isWaitingForAI 控)。
  // QA drawer 開關走 mount/unmount,不需要 visibilitychange / focus refetch。
  const draftId = state.draft?.draftId;
  const turnsLen = state.draft?.turns.length ?? 0;
  const lastRole =
    turnsLen > 0 ? state.draft?.turns[turnsLen - 1]?.role : undefined;
  const shouldPoll = !!projectHash && !!draftId && lastRole === "user";
  const { data: polledDraft } = useApi<Draft | null>(
    async () => {
      if (!shouldPoll || !projectHash || !draftId) return null;
      return await qaApi.getDraft(projectHash, draftId);
    },
    {
      intervalMs: 3000,
      gate: shouldPoll,
      refetchOnVisible: false,
      deps: [projectHash, draftId, lastRole, turnsLen],
    }
  );
  useEffect(() => {
    if (!polledDraft) return;
    const newLast = polledDraft.turns[polledDraft.turns.length - 1];
    if (newLast && newLast.role === "ai") {
      setState((s) => {
        if (s.draft?.draftId !== polledDraft.draftId) return s;
        // race guard:sendTurn optimistic 加 user turn 後,useApi 立刻 fetch disk
        // (disk 仍是 backend turnQA 處理前的舊版,lastRole=ai)→ 若沒擋會蓋掉 optimistic user turn。
        // 只在 polled.turns 嚴格比 local 多時才同步;一樣長度視為 stale 不蓋
        if (polledDraft.turns.length <= (s.draft?.turns.length ?? 0)) return s;
        return { ...s, draft: polledDraft };
      });
    }
  }, [polledDraft]);

  const draftFor = useCallback(
    (pipelineId: string) => drafts.find((d) => d.pipelineId === pipelineId) ?? null,
    [drafts]
  );

  const open = useCallback(
    async (pipelineId: string) => {
      if (!projectHash) return;
      setState((s) => ({ ...s, open: true, pipelineId, busy: true }));
      // 接續 QA 時:不靠 in-memory drafts(可能 stale,e.g. 別 tab 改、或 close 後沒同步)
      // 直接打 backend listDrafts 拿最新,再決定 resume / start
      let latest: Draft[] = [];
      try {
        latest = await qaApi.listDrafts(projectHash);
        setDrafts(latest);
      } catch {
        // 拉清單失敗 → 用 in-memory 的 drafts fallback,不擋
        latest = drafts;
      }
      const existing = latest.find((d) => d.pipelineId === pipelineId);
      if (existing) {
        try {
          const d = await qaApi.getDraft(projectHash, existing.draftId);
          setState({ open: true, pipelineId, draft: d, busy: false });
        } catch (e) {
          setState({ open: true, pipelineId, draft: null, busy: false });
          toastErr("讀取草稿失敗", e);
        }
        return;
      }
      try {
        const { draft } = await qaApi.startQA(projectHash, pipelineId);
        setState({ open: true, pipelineId, draft, busy: false });
        await refreshDrafts();
      } catch (e) {
        setState({ open: true, pipelineId, draft: null, busy: false });
        toastErr("啟動 QA 失敗", e);
      }
    },
    [projectHash, drafts, refreshDrafts, toastErr]
  );

  // close 時若 draft 還是空(沒任何 user turn、沒 spec 進展)→ auto-cancel,
  // 不留殘骸佔 rail QA badge。非空 draft 也要 refreshDrafts,確保 hasActiveDraft / draftFor 正確
  const close = useCallback(async () => {
    const draft = state.draft;
    setState(INITIAL);
    if (!projectHash || !draft) return;
    const userTurns = draft.turns.filter((t) => t.role === "user").length;
    const specEntries = draft.spec ? Object.keys(draft.spec).length : 0;
    if (userTurns === 0 && specEntries === 0) {
      try {
        await qaApi.cancelQA(projectHash, draft.draftId);
      } catch {
        // 失敗就算了,下次 open 同 pipeline 會 resume 看到空 draft
      }
    }
    // 永遠 refresh,讓 FocusColumn 的「+ ticket / 接續 QA」label 即時對齊 disk 狀態
    await refreshDrafts();
  }, [projectHash, state.draft, refreshDrafts]);

  const sendTurn = useCallback(
    async (userMessage: string) => {
      if (!projectHash || !state.draft) return;
      const optimistic: Draft = {
        ...state.draft,
        turns: [
          ...state.draft.turns,
          { role: "user", message: userMessage, ts: Date.now() },
        ],
      };
      setState((s) => ({ ...s, draft: optimistic, busy: true }));
      try {
        const { draft } = await qaApi.turnQA(projectHash, state.draft.draftId, userMessage);
        setState((s) => ({ ...s, draft, busy: false }));
      } catch (e) {
        setState((s) => ({ ...s, busy: false }));
        toastErr("傳送訊息失敗", e);
      }
    },
    [projectHash, state.draft, toastErr]
  );

  const cancel = useCallback(async () => {
    if (!projectHash || !state.draft) {
      setState(INITIAL);
      return;
    }
    setState((s) => ({ ...s, busy: true }));
    try {
      await qaApi.cancelQA(projectHash, state.draft.draftId);
    } catch {}
    setState(INITIAL);
    await refreshDrafts();
  }, [projectHash, state.draft, refreshDrafts]);

  // 跑 split-check 預覽(不寫)。回 { count, specs }。
  const previewSplit = useCallback(
    async (edits?: Partial<TicketSpec>) => {
      if (!projectHash || !state.draft) return null;
      setState((s) => ({ ...s, busy: true }));
      try {
        return await qaApi.previewSplitQA(projectHash, state.draft.draftId, edits);
      } finally {
        setState((s) => ({ ...s, busy: false }));
      }
    },
    [projectHash, state.draft]
  );

  // finalize: splitInto 帶就寫 N 張,沒帶就寫 1 張(原本 spec)。
  // 寫成功後關 drawer
  const finalize = useCallback(
    async (edits?: Partial<TicketSpec>, splitInto?: TicketSpec[]): Promise<unknown | null> => {
      if (!projectHash || !state.draft) return null;
      const draftId = state.draft.draftId;
      setState((s) => ({ ...s, busy: true }));
      try {
        const result = await qaApi.finalizeQA(projectHash, draftId, edits, splitInto);
        setState(INITIAL);
        await refreshDrafts();
        return result;
      } catch (e) {
        setState((s) => ({ ...s, busy: false }));
        toastErr("建立需求單失敗", e);
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    [projectHash, state.draft, refreshDrafts, toastErr]
  );

  return {
    state,
    drafts,
    draftFor,
    open,
    close,
    sendTurn,
    cancel,
    finalize,
    previewSplit,
    refreshDrafts,
  };
}

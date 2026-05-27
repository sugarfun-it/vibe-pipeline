import { useRef } from "react";
import "../../styles/drawer.css";
import "./qa.css";
import type { Draft, TicketSpec } from "../../api/qa";
import { Overlay } from "../../ui/Overlay";
import { PendingCloseConfirm } from "./PendingCloseConfirm";
import { QADrawerHeader } from "./QADrawerHeader";
import { QAFooter } from "./QAFooter";
import { QATranscript } from "./QATranscript";
import { SpecReadyBar } from "./SpecReadyBar";
import { SpecReview } from "./SpecReview";
import { usePendingClose } from "./usePendingClose";
import { useQADrawerFocus } from "./useQADrawerFocus";
import { useQAViewState } from "./useQAViewState";
import { useTranscriptScroll } from "./useTranscriptScroll";

export function QADrawer({
  pipelineName,
  draft,
  busy,
  onSendTurn,
  onFinalize,
  onCancel,
  onClose,
}: {
  pipelineName: string;
  draft: Draft | null;
  busy: boolean;
  onSendTurn: (userMessage: string) => void;
  onFinalize: (edits?: Partial<TicketSpec>, splitInto?: TicketSpec[]) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const composerTextRef = useRef<string>("");
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = "qadr-title";

  const {
    specComplete,
    showReview,
    hasAnyTurn,
    showChecklist,
    setViewOverride,
  } = useQAViewState(draft);
  useQADrawerFocus({ draft, showReview, composerInputRef });
  useTranscriptScroll({ draft, showReview, transcriptRef });
  const {
    pendingClose,
    setPendingClose,
    pendingCancelBtnRef,
    requestClose,
  } = usePendingClose({ composerTextRef, onClose });

  return (
    <Overlay
      role="dialog"
      onRequestClose={requestClose}
      labelledBy={titleId}
      portal={false}
      initialFocus="root"
      surfaceRef={drawerRef}
      stageClassName="qadr-stage"
      surfaceClassName="qadr-drawer"
    >
      <QADrawerHeader
        pipelineName={pipelineName}
        draft={draft}
        hasAnyTurn={hasAnyTurn}
        showChecklist={showChecklist}
        titleId={titleId}
        closeBtnRef={closeBtnRef}
        onRequestClose={requestClose}
      />

      {pendingClose && (
        <PendingCloseConfirm
          pendingCancelBtnRef={pendingCancelBtnRef}
          onContinue={() => setPendingClose(false)}
          onClose={() => {
            setPendingClose(false);
            onClose();
          }}
        />
      )}

      {showReview ? (
        <div className="drawer-body qadr-body qadr-spec-body">
          <SpecReview
            spec={draft!.spec as TicketSpec}
            splitInto={draft?.splitInto}
            busy={busy}
            onCancel={onCancel}
            onFinalize={onFinalize}
            onResumeChat={() => setViewOverride("chat")}
          />
        </div>
      ) : (
        <>
          {/* spec 5/5 齊但 user 在 chat(被 override 或 backend complete=false)→ 顯示「回最終預覽」橫條 */}
          {specComplete && !showReview && (
            <SpecReadyBar
              busy={busy}
              onReview={() => setViewOverride("review")}
            />
          )}
          <QATranscript
            draft={draft}
            busy={busy}
            transcriptRef={transcriptRef}
            onSendTurn={onSendTurn}
          />
          {/* bootstrap 階段(尚未有 draft)整個 footer 都收掉:沒 draft 沒有合法 input,
              composer / cancel / hint 出現只會誤導 user 以為可輸入。等 startQA 回來才掛 footer。 */}
          {draft && (
            <QAFooter
              draft={draft}
              busy={busy}
              composerTextRef={composerTextRef}
              composerInputRef={composerInputRef}
              onSendTurn={onSendTurn}
              onCancel={onCancel}
            />
          )}
        </>
      )}
    </Overlay>
  );
}

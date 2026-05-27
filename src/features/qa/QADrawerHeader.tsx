import type { Draft } from "../../api/qa";
import { SpecChecklist } from "./SpecChecklist";

export function QADrawerHeader({
  pipelineName,
  draft,
  hasAnyTurn,
  showChecklist,
  titleId,
  closeBtnRef,
  onRequestClose,
}: {
  pipelineName: string;
  draft: Draft | null;
  hasAnyTurn: boolean;
  showChecklist: boolean;
  titleId: string;
  closeBtnRef: React.MutableRefObject<HTMLButtonElement | null>;
  onRequestClose: () => void;
}) {
  return (
    <div className="drawer-head qadr-head">
      <div className="drawer-crumb qadr-crumb">
        <span className="qadr-crumb-text">
          <span className="mono qadr-crumb-project" title={pipelineName}>
            {pipelineName}
          </span>
          <span className="qadr-crumb-current">新需求單</span>
        </span>
        <button type="button"
          ref={closeBtnRef}
          className="drawer-close create-x"
          onClick={onRequestClose}
          title={hasAnyTurn ? "關閉並保留草稿（下次可接續）" : "關閉並取消空白草稿"}
          aria-label={hasAnyTurn ? "關閉並保留草稿" : "關閉並取消空白草稿"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="drawer-titlerow">
        <div className="drawer-title" id={titleId}>
          {draft?.spec?.title
            || (draft
              ? hasAnyTurn
                ? "收斂中…"
                : "新需求單"
              : "新需求單")}
        </div>
      </div>
      <div className="drawer-meta mono">
        <span>{draft ? `${draft.turns.length} 輪對話` : "啟動中…"}</span>
        {draft && (
          <>
            <span className="sep">·</span>
            <span
              className="qadr-draft-status"
              title={`draftId: ${draft.draftId}`}
              aria-label={hasAnyTurn ? "草稿已自動保留,關閉後可接續" : "尚未對話,關閉會自動取消空白草稿"}
            >
              {hasAnyTurn ? "草稿已自動保留" : "空白草稿"}
            </span>
          </>
        )}
      </div>
      {showChecklist && <SpecChecklist spec={draft?.spec ?? null} />}
    </div>
  );
}

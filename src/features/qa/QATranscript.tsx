import type { Draft } from "../../api/qa";
import { Bubble, ThinkingDots } from "./Bubble";
import { InlineMultiSelect } from "./InlineMultiSelect";
import {
  BOOTSTRAP_LABEL,
  FIRST_AI_MESSAGE,
  FIRST_AI_OPTIONS,
  lastAiOptions,
} from "./qaDrawerUtils";

export function QATranscript({
  draft,
  busy,
  transcriptRef,
  onSendTurn,
}: {
  draft: Draft | null;
  busy: boolean;
  transcriptRef: React.MutableRefObject<HTMLDivElement | null>;
  onSendTurn: (userMessage: string) => void;
}) {
  return (
    <div
      className="drawer-body qadr-body"
      ref={transcriptRef}
      aria-busy={
        (!draft && busy) ||
        (draft &&
          (busy || draft.turns[draft.turns.length - 1]?.role === "user"))
          ? true
          : undefined
      }
    >
      {!draft && busy && (
        <div className="qadr-bootstrap" role="status" aria-live="polite">
          <ThinkingDots />
          <span className="qadr-bootstrap-label">{BOOTSTRAP_LABEL}</span>
          <span className="qadr-bootstrap-sub">
            正在準備這次的需求對話，稍候即可開始描述。
          </span>
        </div>
      )}
      {draft && <BubbleList draft={draft} busy={busy} onSendTurn={onSendTurn} />}
    </div>
  );
}

function BubbleList({
  draft,
  busy,
  onSendTurn,
}: {
  draft: Draft;
  busy: boolean;
  onSendTurn: (userMessage: string) => void;
}) {
  const lastTurn = draft.turns[draft.turns.length - 1];
  // last 是 user → AI 還在跑(或 user 中途關 drawer 再回來,backend 仍 pending),
  // 顯思考中。useQA 會 poll 把 AI 回覆寫回 state.draft
  const waitingForAI = lastTurn?.role === "user";
  const showThinking = busy || waitingForAI;
  const emptyTurns = draft.turns.length === 0;
  const last = lastAiOptions(draft);
  const showInlineMulti =
    !emptyTurns &&
    !showThinking &&
    last.mode === "multi" &&
    last.options.length > 0;

  return (
    <>
      <Bubble kind="ai" message={FIRST_AI_MESSAGE} />
      {emptyTurns && (
        <div className="qadr-empty-starter">
          <div className="qadr-starter-label" id="qadr-starter-label">
            快速起點（可直接點選，或在下方輸入自訂內容）
          </div>
          <div
            className="qadr-suggestions"
            role="group"
            aria-labelledby="qadr-starter-label"
          >
            {FIRST_AI_OPTIONS.map((o) => (
              <button
                type="button"
                key={o}
                className="vp-chip vp-chip--action qadr-suggestion"
                onClick={() => onSendTurn(o)}
                disabled={busy}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}
      {draft.turns.map((t) => (
        <Bubble key={t.ts + ":" + t.role} kind={t.role} message={t.message} />
      ))}
      {showInlineMulti && (
        <InlineMultiSelect
          options={last.options}
          busy={busy}
          onSendMulti={(picks) => onSendTurn(picks.join("、"))}
        />
      )}
      {showThinking && (
        <div
          className="qadr-loading"
          role="status"
          aria-live="polite"
          id="qadr-thinking-status"
        >
          <span>助理思考中</span>
          <ThinkingDots />
        </div>
      )}
    </>
  );
}

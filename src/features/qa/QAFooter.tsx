import type { Draft, TicketSpec } from "../../api/qa";
import { Composer } from "./Composer";
import { FIELD_LABELS } from "./SpecChecklist";
import { lastAiOptions } from "./qaDrawerUtils";

export function QAFooter({
  draft,
  busy,
  composerTextRef,
  composerInputRef,
  onSendTurn,
  onCancel,
}: {
  draft: Draft;
  busy: boolean;
  composerTextRef: React.MutableRefObject<string>;
  composerInputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  onSendTurn: (userMessage: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="drawer-foot qadr-foot">
      <SpecProgress spec={draft.spec} />
      <QAComposer
        draft={draft}
        busy={busy}
        composerTextRef={composerTextRef}
        composerInputRef={composerInputRef}
        onSendTurn={onSendTurn}
        onCancel={onCancel}
      />
    </div>
  );
}

function SpecProgress({ spec }: { spec: Partial<TicketSpec> | null | undefined }) {
  // spec 進度提示:防 AI 嘴砲「可以建 ticket」但實際還沒齊讓 user 困惑
  if (!spec) return null;
  const missing = FIELD_LABELS.filter((f) => {
    const v = spec?.[f.key];
    if (v == null || v === "") return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (f.key === "mode") return v !== "step" && v !== "iter";
    return false;
  });
  if (missing.length === 0) return null;
  const filled = FIELD_LABELS.length - missing.length;
  const labels = missing.map((m) => m.label);
  const srSentence = `規格已完成 ${filled} / ${FIELD_LABELS.length}，待補：${labels.join("、")}。`;

  return (
    <div
      className="qadr-progress mono"
      role="status"
      aria-live="polite"
      aria-label={srSentence}
    >
      <span aria-hidden="true">
        規格 {filled}/{FIELD_LABELS.length} · 待補
      </span>
      {missing.map((m, i) => (
        <span
          key={m.key}
          className="qadr-progress-missing"
          aria-hidden="true"
        >
          {m.label}
          {i < missing.length - 1 ? "" : ""}
        </span>
      ))}
    </div>
  );
}

function QAComposer({
  draft,
  busy,
  composerTextRef,
  composerInputRef,
  onSendTurn,
  onCancel,
}: {
  draft: Draft;
  busy: boolean;
  composerTextRef: React.MutableRefObject<string>;
  composerInputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  onSendTurn: (userMessage: string) => void;
  onCancel: () => void;
}) {
  const last = lastAiOptions(draft);
  const isFirstTurn = draft.turns.length === 0;
  // multi 模式 options 改 render 成 inline reply block(InlineMultiSelect)在對話脈絡內,
  // composer 只保留輸入列。mobile 不會再被 sticky footer 整組選項吃掉視野。
  // single 模式 options 維持塞在 footer(短 list 排在輸入上方;首輪也走 inline starter)。
  const composerOptions =
    isFirstTurn || last.mode === "multi" ? [] : last.options;
  // chat_thinking:last turn 是 user → AI 還在跑,把 textarea / send / options 一併鎖,
  // 避免 user 再連送一輪(對 backend 也沒意義,turnQA 還沒回來)
  const lastTurn = draft.turns[draft.turns.length - 1];
  const waitingForAI = lastTurn?.role === "user";
  const composerBusy = busy || waitingForAI;

  return (
    <Composer
      options={composerOptions}
      optionsMode={last.mode}
      busy={composerBusy}
      onSend={(msg) => {
        onSendTurn(msg);
      }}
      onCancel={onCancel}
      onTextChange={(v) => {
        composerTextRef.current = v;
      }}
      inputRef={composerInputRef}
    />
  );
}

import { PlusIcon } from "../../ui/icons";

export function EmptyTickets({
  hasActiveDraft,
  onAddTicket,
}: {
  hasActiveDraft: boolean;
  onAddTicket: () => void;
}) {
  return (
    <div className="focus-empty">
      <div className="focus-empty-title">
        {hasActiveDraft ? "有一張 ticket 在 QA 中" : "還沒任何 ticket"}
      </div>
      <div className="focus-empty-desc">
        {hasActiveDraft
          ? "之前開了 QA 但沒收尾,點下方按鈕接續對話。"
          : "用「+ ticket」開 QA drawer,跟 AI 對話收斂出 goal / acceptance / prompt,完成後加進 pipeline。"}
      </div>
      <button type="button"
        className="btn btn-primary focus-empty-cta"
        onClick={onAddTicket}
      >
        <PlusIcon /> {hasActiveDraft ? "接續 QA" : "建第一張 ticket"}
      </button>
    </div>
  );
}

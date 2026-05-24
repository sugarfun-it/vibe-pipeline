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
      <h2 className="focus-empty-title">
        {hasActiveDraft ? "有一張 ticket 在 QA 中" : "還沒任何 ticket"}
      </h2>
      <div className="focus-empty-desc">
        {hasActiveDraft
          ? "之前開了 QA 但還沒收尾，按「接續 QA」繼續對話。"
          : "用上方「+ 新增 ticket」開始跟 AI 對話,一起整理目標、驗收條件與提示詞,完成後加入 pipeline。"}
      </div>
      <button type="button"
        className={
          "btn focus-empty-cta " +
          (hasActiveDraft ? "btn-accent" : "btn-primary")
        }
        onClick={onAddTicket}
      >
        <PlusIcon aria-hidden="true" /> {hasActiveDraft ? "接續 QA" : "新增第一張 ticket"}
      </button>
    </div>
  );
}

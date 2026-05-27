export function PendingCloseConfirm({
  pendingCancelBtnRef,
  onContinue,
  onClose,
}: {
  pendingCancelBtnRef: React.MutableRefObject<HTMLButtonElement | null>;
  onContinue: () => void;
  onClose: () => void;
}) {
  return (
    <section
      className="qadr-close-confirm"
      role="group"
      aria-labelledby="qadr-close-confirm-msg"
    >
      <p
        id="qadr-close-confirm-msg"
        className="qadr-close-confirm-msg"
        role="status"
        aria-live="polite"
      >
        輸入框還有未送出的內容，要關閉嗎？（草稿仍會保留，下次可接續）
      </p>
      <div className="qadr-close-confirm-actions">
        <button
          ref={pendingCancelBtnRef}
          type="button"
          className="btn"
          onClick={onContinue}
        >
          繼續編輯
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onClose}
        >
          關閉並保留草稿
        </button>
      </div>
    </section>
  );
}

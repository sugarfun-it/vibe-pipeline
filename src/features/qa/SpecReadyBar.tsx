import { ArrowRightIcon } from "../../ui/icons";

export function SpecReadyBar({
  busy,
  onReview,
}: {
  busy: boolean;
  onReview: () => void;
}) {
  return (
    <div className="qadr-spec-ready-bar">
      <span
        className="qadr-spec-ready-bar-text"
        role="status"
        aria-live="polite"
      >
        規格已備齊，可隨時送出建立需求單。
      </span>
      <button
        type="button"
        className="btn btn-primary qadr-spec-ready-bar-btn"
        onClick={onReview}
        disabled={busy}
      >
        查看最終預覽
        <ArrowRightIcon aria-hidden focusable="false" />
      </button>
    </div>
  );
}

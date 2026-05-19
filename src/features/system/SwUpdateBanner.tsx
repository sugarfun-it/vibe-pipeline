import { useState } from "react";
import { useSwUpdate } from "../../lib/swUpdate";

export function SwUpdateBanner() {
  const { needRefresh, updateSW } = useSwUpdate();
  const [dismissed, setDismissed] = useState(false);

  if (!needRefresh || dismissed) return null;

  return (
    <div className="sw-update-banner fade-up" role="status" aria-live="polite">
      <span className="sw-update-banner__text">有新版可更新</span>
      <button
        type="button"
        className="sw-update-banner__btn"
        onClick={() => updateSW()}
      >
        套用更新
      </button>
      <button
        type="button"
        className="icon-btn sw-update-banner__close"
        aria-label="關閉更新提示"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}

import type { ReactNode } from "react";
import { FolderQuestionIcon } from "../../../ui/icons";
import { useProjectPicker } from "../../../contexts/ProjectPickerContext";
import "./emptyProject.css";

export const EMPTY_PROJECT_DEFAULT_MESSAGE = "尚未選擇專案資料夾";
export const EMPTY_PROJECT_DEFAULT_HINT =
  "請從上方「選擇專案」選取資料夾。系統會自動檢查初始化狀態，完成後即可建立 pipeline。";
export const EMPTY_PROJECT_DEFAULT_TOPBAR_HINT = "↑ 點上方「選擇專案」";
export const EMPTY_PROJECT_DEFAULT_CTA_LABEL = "選擇專案資料夾…";

export function EmptyProject({
  message = EMPTY_PROJECT_DEFAULT_MESSAGE,
  hint = EMPTY_PROJECT_DEFAULT_HINT,
  pointToTopBar = true,
  topBarHint = EMPTY_PROJECT_DEFAULT_TOPBAR_HINT,
  action,
  // pointToTopBar 是「使用者需要選 project」的訊號 → 預設一起 render CTA。loading / error
  // 狀態通常 pointToTopBar=false,自然就不會跑出多餘按鈕。caller 仍可用 action 完全 override。
  showPickerCta = pointToTopBar,
  pickerCtaLabel = EMPTY_PROJECT_DEFAULT_CTA_LABEL,
}: {
  message?: string;
  hint?: string;
  pointToTopBar?: boolean;
  topBarHint?: string;
  action?: ReactNode;
  showPickerCta?: boolean;
  pickerCtaLabel?: string;
}) {
  const picker = useProjectPicker();
  const resolvedAction = action ?? (showPickerCta ? (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => picker.openBrowse()}
    >
      {pickerCtaLabel}
    </button>
  ) : null);
  return (
    <section
      className="empty-project-root"
      role="status"
      aria-live="polite"
      aria-labelledby="empty-project-title"
      aria-describedby="empty-project-hint"
    >
      {pointToTopBar && (
        <div className="empty-project-topbar-hint empty-project-topbar-hint--in-flow">
          <span>{topBarHint}</span>
        </div>
      )}
      <div className="empty-project-icon" aria-hidden="true">
        <FolderQuestionIcon />
      </div>
      <h2 id="empty-project-title" className="empty-project-message">
        {message}
      </h2>
      <p id="empty-project-hint" className="empty-project-hint">
        {hint}
      </p>
      {resolvedAction ? <div className="empty-project-action">{resolvedAction}</div> : null}
    </section>
  );
}

import type { ReactNode } from "react";
import { FolderQuestionIcon } from "../../ui/icons";
import "./emptyProject.css";

export const EMPTY_PROJECT_DEFAULT_MESSAGE = "尚未選擇專案資料夾";
export const EMPTY_PROJECT_DEFAULT_HINT =
  "請從上方「選擇專案」選取資料夾。系統會自動檢查初始化狀態，完成後即可建立 pipeline。";
export const EMPTY_PROJECT_DEFAULT_TOPBAR_HINT = "↑ 點上方「選擇專案」";

export function EmptyProject({
  message = EMPTY_PROJECT_DEFAULT_MESSAGE,
  hint = EMPTY_PROJECT_DEFAULT_HINT,
  pointToTopBar = true,
  topBarHint = EMPTY_PROJECT_DEFAULT_TOPBAR_HINT,
  action,
}: {
  message?: string;
  hint?: string;
  pointToTopBar?: boolean;
  topBarHint?: string;
  action?: ReactNode;
}) {
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
      {action ? <div className="empty-project-action">{action}</div> : null}
    </section>
  );
}

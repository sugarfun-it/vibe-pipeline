import type { ReactNode } from "react";
import { FolderQuestionIcon } from "../../ui/icons";
import "./emptyProject.css";

export const EMPTY_PROJECT_DEFAULT_MESSAGE = "尚未選擇專案資料夾";
export const EMPTY_PROJECT_DEFAULT_HINT =
  "請先在上方工具列「選擇專案」中選取資料夾；系統會自動偵測是否已初始化，並引導你完成設定。選好專案後才能建立 pipeline。";
export const EMPTY_PROJECT_DEFAULT_TOPBAR_HINT = "上方工具列「選擇專案」";

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
      role="region"
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

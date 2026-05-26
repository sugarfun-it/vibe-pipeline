import { useId } from "react";
import { ArrowRightIcon } from "../../ui/icons";
import { Overlay } from "../../ui/Overlay";
import type { Pipeline } from "../../../shared/types";
import "../../styles/drawer.css";

// conflict_await 時跳的對話框,給 user 一個明確「要不要交給助理解」的決策關卡(token 花費前的最後確認)
export function SyncConflictModal({
  pipeline,
  onConfirmAi,
  onCancel,
}: {
  pipeline: Pipeline;
  onConfirmAi: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const j = pipeline.syncJob;
  if (!j || j.state !== "conflict_await") return null;
  const files = j.conflictFiles ?? [];
  return (
    <Overlay
      role="alertdialog"
      onRequestClose={onCancel}
      labelledBy={titleId}
      stageClassName="drawer-stage--modal"
      surfaceClassName="drawer--modal modal-card"
    >
      <div id={titleId} className="modal-title">同步遇到衝突</div>
      <div className="modal-body">
        <p className="focus-modal-text">
          落後 {j.behindCount} 個 commit，合併時撞到 <strong>{files.length}</strong> 個檔案衝突：
        </p>
        <ul className="mono focus-modal-files">
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="focus-modal-text--mt">
          要交給助理自動解嗎？隨時可取消。
        </p>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          取消並中止合併
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirmAi}>
          交給助理解 <ArrowRightIcon />
        </button>
      </div>
    </Overlay>
  );
}

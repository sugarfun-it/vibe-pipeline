import { useEffect, useRef, useState } from "react";
import { CheckIconSm, CloseIcon, PencilIcon } from "../../../ui/icons";
import type { Pipeline } from "../../../../shared/types";

// 可編輯的 pipeline title — 點 ✎ 進編輯模式,Enter 存,Esc 取消。
// 重名 / 格式不對 / running 不准存。
export function FocusTitle({
  pipeline,
  onRename,
  existingNames,
}: {
  pipeline: Pipeline;
  onRename?: (pipelineId: string, newName: string) => void;
  existingNames: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pipeline.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // 切 pipeline(id) 或 name 從外部變動時 reset draft / 退出編輯模式
  // biome-ignore lint/correctness/useExhaustiveDependencies: pipeline.id forces reset on pipeline switch even if name happens to match
  useEffect(() => {
    setDraft(pipeline.name);
    setEditing(false);
  }, [pipeline.id, pipeline.name]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // mobile-focus-001 / 004:rename 期間在 <body> 標 data-renaming,讓 board.css
  // 在窄寬度下隱藏 overflow ⋯ 跟 branch chip 那條 row,避免擠不下 / 重複資訊。
  useEffect(() => {
    if (editing) {
      document.body.setAttribute("data-renaming", "true");
      return () => {
        document.body.removeAttribute("data-renaming");
      };
    }
    return undefined;
  }, [editing]);

  const trimmed = draft.trim();
  const formatOk = /^[a-z0-9][a-z0-9-_]*$/.test(trimmed);
  const taken =
    trimmed !== pipeline.name && existingNames.includes(trimmed);
  const valid = trimmed.length > 0 && formatOk && !taken;
  const lockedByState =
    pipeline.state === "running" ||
    pipeline.state === "queued";

  function commit() {
    if (!valid || trimmed === pipeline.name) {
      setEditing(false);
      setDraft(pipeline.name);
      return;
    }
    onRename?.(pipeline.id, trimmed);
    setEditing(false);
  }

  // a11y:invalid 時提供具體訊息給 SR / 顯式 hint
  const errorMsg = taken
    ? "名稱已存在"
    : !formatOk
    ? "只能 a-z / 0-9 / - / _,首字英數"
    : "";
  const errorId = "focus-title-error";

  if (editing) {
    return (
      <span className="focus-title-edit" role="group" aria-label="重新命名 pipeline">
        <input
          ref={inputRef}
          className={"mono focus-title-input" + (valid ? "" : " is-invalid")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setEditing(false);
              setDraft(pipeline.name);
            }
          }}
          spellCheck={false}
          autoComplete="off"
          aria-label="pipeline 名稱"
          aria-invalid={!valid}
          aria-describedby={errorMsg ? errorId : undefined}
        />
        {errorMsg && (
          <span
            id={errorId}
            role="status"
            aria-live="polite"
            style={{
              // 視覺可見的 inline 錯誤訊息 — sighted user 跟 SR 都看得到
              fontSize: 11,
              color: "var(--failed)",
              marginLeft: 4,
              whiteSpace: "nowrap",
            }}
          >
            {errorMsg}
          </span>
        )}
        <button type="button"
          className="btn btn-primary focus-title-edit-confirm"
          onClick={commit}
          disabled={!valid || trimmed === pipeline.name}
          title={
            taken
              ? "名稱已存在"
              : !formatOk
              ? "只能 a-z / 0-9 / - / _,首字英數"
              : "儲存 pipeline 名稱"
          }
          aria-label="儲存 pipeline 名稱"
        >
          <CheckIconSm aria-hidden="true" />
        </button>
        <button type="button"
          className="btn focus-title-edit-cancel"
          onClick={() => {
            setEditing(false);
            setDraft(pipeline.name);
          }}
          title="取消 (Esc)"
          aria-label="取消重新命名"
        >
          <CloseIcon aria-hidden="true" />
        </button>
      </span>
    );
  }

  return (
    <h2 className="focus-title focus-title-edit">
      {pipeline.name}
      {onRename && (
        <button type="button"
          className="btn btn-ghost focus-title-edit-btn"
          onClick={() => setEditing(true)}
          disabled={lockedByState}
          title={lockedByState ? "running 中不能改名" : "改名"}
          aria-label={lockedByState ? "running 中無法重新命名" : "重新命名 pipeline"}
        >
          <PencilIcon />
        </button>
      )}
    </h2>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Pipeline } from "../../types/pipeline";

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

  if (editing) {
    return (
      <span className="focus-title-edit">
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
        />
        <button type="button"
          className="btn btn-primary"
          onClick={commit}
          disabled={!valid || trimmed === pipeline.name}
          title={
            taken
              ? "名稱已存在"
              : !formatOk
              ? "只能 a-z / 0-9 / - / _,首字英數"
              : "存"
          }
        >
          ↵
        </button>
        <button type="button"
          className="btn"
          onClick={() => {
            setEditing(false);
            setDraft(pipeline.name);
          }}
          title="取消 (Esc)"
        >
          ✕
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
        >
          ✎
        </button>
      )}
    </h2>
  );
}

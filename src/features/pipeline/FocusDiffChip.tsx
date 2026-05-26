import { useState } from "react";
import { DiffModal } from "./DiffModal";
import type { DiffStat } from "../../api";
import type { Pipeline } from "../../types/pipeline";

// diff stat chip + diff modal 開關 — 只在 diffStat 非空 + projectHash 有值才渲染
export function FocusDiffChip({
  pipeline,
  projectHash,
  diffStat,
}: {
  pipeline: Pipeline;
  projectHash: string;
  diffStat: DiffStat;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chip mono focus-diff-chip"
        title={`點擊看完整 diff:${diffStat.files} files,+${diffStat.added} -${diffStat.deleted} vs ${pipeline.baseBranch || "base"}`}
        aria-label={`查看 diff:${diffStat.files} 個檔案,新增 ${diffStat.added} 行、刪除 ${diffStat.deleted} 行,對比 ${pipeline.baseBranch || "base"}`}
        onClick={() => setDiffOpen(true)}
      >
        <span aria-hidden className="focus-diff-added">+{diffStat.added}</span>
        <span aria-hidden className="focus-diff-sep">·</span>
        <span aria-hidden className="focus-diff-deleted">-{diffStat.deleted}</span>
        <span aria-hidden className="focus-diff-files">{diffStat.files}f</span>
      </button>
      {diffOpen && (
        <DiffModal
          projectHash={projectHash}
          pipelineId={pipeline.id}
          pipelineBranch={pipeline.branch}
          baseBranch={pipeline.baseBranch || "main"}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </>
  );
}

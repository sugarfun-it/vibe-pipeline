import type { DiffFile } from "../../../api";
import { splitPath } from "./diffHelpers";

type DiffFileListProps = {
  files: DiffFile[];
  activeFile: string | null;
  onJumpToFile: (path: string) => void;
};

export function DiffFileList({ files, activeFile, onJumpToFile }: DiffFileListProps) {
  return (
    <nav className="diff-modal-files" aria-label="檔案清單">
      {files.map((f) => {
        const isActive = activeFile === f.path;
        const parts = splitPath(f.path);
        return (
          <button
            key={f.path}
            type="button"
            className={"diff-modal-file-row mono" + (isActive ? " is-active" : "")}
            onClick={() => onJumpToFile(f.path)}
            title={f.path}
            aria-label={`${isActive ? "目前在 " : "跳到 "}${f.path},新增 ${f.added} 行,刪除 ${f.deleted} 行`}
            aria-current={isActive ? "location" : undefined}
          >
            {/* 兩行排版:
                - 第一行:basename + ext (basename ellipsis,ext 永不縮)
                - 第二行:dir (muted,ellipsis)
                視覺 span 已被 button.aria-label 涵蓋,標 aria-hidden 避免 SR 讀兩次 */}
            <span className="diff-modal-file-text" aria-hidden>
              <span className="diff-modal-file-line1">
                <span className="diff-modal-file-base">{parts.base}</span>
                {parts.ext && <span className="diff-modal-file-ext">{parts.ext}</span>}
              </span>
              {parts.dir && (
                <span className="diff-modal-file-dir">{parts.dir.replace(/\/$/, "")}</span>
              )}
            </span>
            <span className="diff-modal-file-stat" aria-hidden>
              <span className="diff-modal-stat-added">+{f.added}</span>
              <span className="diff-modal-stat-deleted">−{f.deleted}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

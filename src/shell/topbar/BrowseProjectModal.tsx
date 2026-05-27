import { createPortal } from "react-dom";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ArrowUpIcon, CloseIcon, FileIcon, FolderIcon, HomeIcon } from "../../ui/icons";
import type * as api from "../../api";

type BrowseProjectModalProps = {
  browseCloseRef: RefObject<HTMLButtonElement>;
  browseData: api.BrowseResult | null;
  browseDialogRef: RefObject<HTMLDivElement>;
  browseLoading: boolean;
  busy: boolean;
  error: string | null;
  lastTriedPath: string | undefined;
  loadBrowse: (path?: string) => Promise<void>;
  openByPath: (path: string) => void;
  setBrowseData: Dispatch<SetStateAction<api.BrowseResult | null>>;
  setBrowseOpen: (v: boolean) => void;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function BrowseProjectModal({
  browseCloseRef,
  browseData,
  browseDialogRef,
  browseLoading,
  busy,
  error,
  lastTriedPath,
  loadBrowse,
  openByPath,
  setBrowseData,
  setBrowseOpen,
  setError,
}: BrowseProjectModalProps) {
  return createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="browse-modal-title"
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setBrowseOpen(false);
              setBrowseData(null);
              setError(null);
            }
          }}
        >
          <div className="modal-card browse-modal-card" ref={browseDialogRef}>
            <div className="browse-modal-head">
              <div id="browse-modal-title" className="modal-title">選擇專案資料夾</div>
              <button
                type="button"
                className="drawer-close"
                onClick={() => {
                  if (busy) return;
                  setBrowseOpen(false);
                  setBrowseData(null);
                  setError(null);
                }}
                disabled={busy}
                title="關閉"
                aria-label="關閉「選擇專案資料夾」對話框"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="modal-body">
              <div className="browse-path-row">
                <span className="browse-path-label" id="browse-path-label">目前位置</span>
                <div
                  className={"mono browse-current-path" + (!browseData && !lastTriedPath && !error ? " is-loading" : "") + (!browseData && error ? " is-error-path" : "")}
                  aria-labelledby="browse-path-label"
                  aria-live="polite"
                  title={browseData?.path ?? lastTriedPath ?? (error ? "尚未取得位置" : "正在讀取資料夾")}
                >
                  {/* 三段:loaded(顯示 path) / first-load error(顯示 "尚未取得位置") /
                      retry-after-known-path error(顯示 lastTriedPath) / loading(italic).
                      advisor browse-error-r1:錯誤狀態不能還顯示 "正在讀取資料夾…" loading copy */}
                  {browseData?.path ?? lastTriedPath ?? (error ? "尚未取得位置" : "正在讀取資料夾…")}
                </div>
              </div>
              <div className="browse-toolbar" role="toolbar" aria-label="資料夾導覽">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadBrowse(browseData?.parent ?? undefined)}
                  disabled={!browseData?.parent || browseLoading}
                  title="回到上一層資料夾"
                  aria-label="回到上一層資料夾"
                >
                  <ArrowUpIcon /> 上層
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadBrowse(browseData?.home)}
                  disabled={browseLoading || !browseData?.home}
                  title="跳回使用者家目錄"
                  aria-label="跳回使用者家目錄"
                >
                  <HomeIcon /> 首頁
                </button>
                {(browseData?.drives.length ?? 0) > 0 && (
                  <span className="browse-drives-group">
                    <span className="browse-drives-label">磁碟:</span>
                    {browseData!.drives.map((d) => {
                      const active = browseData?.path.toUpperCase().startsWith(d.toUpperCase());
                      return (
                        <button
                          key={d}
                          type="button"
                          className={"btn browse-drive-btn" + (active ? " is-active" : "")}
                          onClick={() => void loadBrowse(d)}
                          disabled={browseLoading}
                          title={`切到磁碟 ${d}`}
                          aria-label={`切到磁碟 ${d}`}
                          aria-pressed={active ? true : false}
                        >
                          {d.replace("\\", "")}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
              <ul className="browse-list" role="list" aria-label="資料夾內容">
                {browseLoading ? (
                  <li className="browse-list-placeholder browse-list-placeholder--center">
                    <span aria-hidden className="browse-list-placeholder-spinner" />
                    <span>載入中…</span>
                  </li>
                ) : !browseData && error ? (
                  // error + no data → 不要顯示一個無意義的 dash;給出明確的「重試」入口
                  // (advisor 2026-05-24:browse_modal_error 不能變 dead-end)
                  // r2: 合併 footer error msg 進 placeholder 內,單一錯誤區塊
                  <li className="browse-list-placeholder browse-list-placeholder--center browse-list-placeholder--error">
                    <span aria-hidden className="browse-list-placeholder-icon">!</span>
                    <span className="browse-list-placeholder-title">讀取失敗</span>
                    <span className="browse-list-placeholder-detail">{error}</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void loadBrowse(lastTriedPath)}
                      disabled={browseLoading}
                    >
                      重試
                    </button>
                  </li>
                ) : !browseData ? (
                  <li className="browse-list-placeholder browse-list-placeholder--center">—</li>
                ) : browseData.entries.length === 0 ? (
                  <li className="browse-list-placeholder browse-list-placeholder--center">
                    <span aria-hidden className="browse-list-placeholder-folder"><FolderIcon /></span>
                    <span>(空資料夾)</span>
                  </li>
                ) : (
                  browseData.entries.map((e) => (
                    <li key={e.name} role="listitem">
                      <button
                        type="button"
                        onClick={() => {
                          if (!e.isDir) return;
                          const next = browseData.path + (browseData.path.endsWith(browseData.sep) ? "" : browseData.sep) + e.name;
                          void loadBrowse(next);
                        }}
                        disabled={!e.isDir || browseLoading}
                        className="browse-entry"
                        aria-label={e.isDir ? `開啟資料夾 ${e.name}` : `${e.name}(檔案,不可選)`}
                      >
                        <span aria-hidden>{e.isDir ? <FolderIcon /> : <FileIcon />}</span>
                        <span className="browse-entry-name">{e.name}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {/* footer error only when error 但仍有 browseData(stale data 警告);
                  全失敗(無 data) 已合進中央 placeholder,不重複(advisor browse-error-r1) */}
              {error && browseData && (
                <div className="browse-error" role="alert">{error}</div>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                ref={browseCloseRef}
                className="btn"
                onClick={() => {
                  if (busy) return;
                  setBrowseOpen(false);
                  setBrowseData(null);
                  setError(null);
                }}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => browseData && void openByPath(browseData.path)}
                disabled={busy || !browseData}
                title={browseData ? `將「${browseData.path}」設為目前專案` : undefined}
              >
                {busy ? "開啟中…" : "選擇目前資料夾"}
              </button>
            </div>
          </div>
        </div>,
        document.body
  );
}

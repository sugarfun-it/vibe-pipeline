import type { FullDiff } from "../../../api";

type DiffModalStatusStatesProps = {
  loadFailed: boolean;
  diff: FullDiff | null;
  errMsg: { user: string; tech: string } | null;
  longWait: boolean;
  baseBranch: string;
  onRetry: () => void;
  copied: boolean;
};

export function DiffModalStatusStates({
  loadFailed,
  diff,
  errMsg,
  longWait,
  baseBranch,
  onRetry,
  copied,
}: DiffModalStatusStatesProps) {
  return (
    <>
      {loadFailed && !diff && (
        // role=alert 已存在;humanized user msg 直接放 modal 內(error-001),tech 折疊在 details(error-004)。
        // 不再開 toast 避免雙 alert / 雙 SR 宣告(error-002 / error-003)。
        <div className="diff-modal-err" role="alert" aria-live="assertive">
          <div className="diff-modal-err-title">讀取差異失敗</div>
          {errMsg?.user && (
            <div className="diff-modal-err-detail">{errMsg.user}</div>
          )}
          <button
            type="button"
            className="diff-modal-retry"
            onClick={onRetry}
            aria-label="重新讀取差異"
          >
            重新讀取
          </button>
          {errMsg?.tech && (
            <details className="diff-modal-err-tech-wrap">
              <summary>顯示技術細節</summary>
              <div className="diff-modal-err-tech mono">{errMsg.tech}</div>
            </details>
          )}
        </div>
      )}
      {!loadFailed && !diff && (
        <div className="diff-modal-loading" role="status" aria-live="polite">
          <span className="diff-modal-loading-spinner" aria-hidden />
          {longWait ? "仍在讀取…(可能 worktree 較大)" : "載入中…"}
        </div>
      )}
      {diff && diff.files.length === 0 && (
        // 不只一行「沒有改動。」— 補上 title + desc 解釋為什麼 chip 顯示有改動但這裡卻空,
        // 並給 重新讀取 入口讓使用者不必關掉再開(copy-empty-001 / interaction-empty-001 / structure-empty-001
        // / a11y-empty-001 / design-empty-001 / i18n-empty-001)。
        <div className="diff-modal-empty" role="status" aria-live="polite">
          <div className="diff-modal-empty-title">目前沒有可顯示的改動</div>
          <div className="diff-modal-empty-desc">
            工作樹和 <span className="mono">{baseBranch}</span> 對比後沒有實質差異(可能剛被 reset 或 stash)。
          </div>
          <button
            type="button"
            className="diff-modal-retry"
            onClick={onRetry}
            aria-label="重新讀取差異"
          >
            重新讀取
          </button>
        </div>
      )}
      {/* 獨立 aria-live region 給「已複製」公告 — 不掛在 button 上避免 label 變更 + live region 雙重宣告
          導致部分 SR 把舊新 label 都唸一次(a11y-001 / a11y-002 copied)。
          aria-atomic=true 確保整段一次完整宣告,避免 partial diff 觸發兩次。 */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {copied ? "已複製差異到剪貼簿" : ""}
      </div>
    </>
  );
}

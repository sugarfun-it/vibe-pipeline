import { useId, useState } from "react";
import { ChevronRightIcon, CloseIcon, FolderQuestionIcon, RefreshIcon, SpinnerIcon } from "../../ui/icons";
import * as api from "../../api/projects";
import type { Project } from "../../../shared/types";
import { useToast } from "../../ui/Toast";
import { Overlay } from "../../ui/Overlay";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import "../../styles/init.css";

export function InitPopup({
  project,
  onInitialized,
  onDismiss,
}: {
  project: Project;
  onInitialized: (next: Project) => void;
  onDismiss: () => void;
}) {
  const { toast } = useToast();
  const [alsoGitInit, setAlsoGitInit] = useState(true);
  const titleId = useId();
  const scanId = useId();
  const descId = useId();
  const busyHintId = useId();

  const [autoInit, { pending: busy }] = useAsyncAction(async () => {
    try {
      let p = project;
      if (!p.hasGit && alsoGitInit) {
        p = await api.gitInit(p.hash);
      }
      const next = await api.init(p.hash);
      onInitialized(next);
    } catch (e) {
      toast(`初始化失敗:${e instanceof Error ? e.message : String(e)}`, { variant: "danger" });
      throw e;
    }
  });

  // 用 Overlay primitive(portal / role=dialog / ESC / scrim click / focus trap / restore focus 都吃免費)
  // initialFocus="first" — 把焦點放在第一個可 focus(「稍後再說」按鈕),避免落到 root 後 user 第一下 Tab 才到按鈕
  // surface 套 init-card 保留原本 440px 寬 + 內部排版;不掛 .drawer--modal,因為 init-card 有自己的 padding / 動畫
  return (
    <Overlay
      role="dialog"
      onRequestClose={busy ? () => {} : onDismiss}
      labelledBy={titleId}
      describedBy={`${scanId} ${descId}${busy ? ` ${busyHintId}` : ""}`}
      stageClassName="drawer-stage--modal init-popup-stage"
      surfaceClassName="init-card fade-up"
      initialFocus="first"
    >
      <div className="init-scan" id={scanId}>
        <div className="init-scan-icon">
          <FolderQuestionIcon />
        </div>
        <div className="init-scan-text mono">
          <div className="init-scan-status">
            <span className="init-dim">這個專案還沒初始化</span>
          </div>
          <div className="init-scan-path">{project.path}</div>
          <div className="init-scan-miss">
            <span className="init-icon-accent" aria-hidden><CloseIcon /></span>{" "}
            找不到 <code className="init-inline-code">.vibe-pipeline/</code>
          </div>
          {!project.hasGit && (
            <div className="init-scan-miss">
              <span className="init-icon-accent" aria-hidden><CloseIcon /></span>{" "}
              找不到 <code className="init-inline-code">.git/</code>（runner 階段需要）
            </div>
          )}
        </div>
      </div>

      <div className="init-body">
        <h1 id={titleId} className="init-title">
          要在這個專案初始化 <span className="init-h1-nowrap">vibe-pipeline</span> 嗎?
        </h1>
        <p id={descId} className="init-desc">
          在 <code className="init-inline-code">{project.name}</code> 底下建立 <code className="init-inline-code">.vibe-pipeline/</code> 和必須的專案層級設定。
        </p>
      </div>

      <div className="init-tree-wrap">
        <div className="init-section-label mono">會建立</div>
        <div className="init-tree mono">
          <div>
            <span className="init-tree-glyph" aria-hidden><ChevronRightIcon /></span> .vibe-pipeline/
          </div>
          <div className="init-tree-row">
            <span className="init-tree-line">├──</span>
            <span className="init-tree-name">config.json</span>
            <span className="init-tree-cmt">專案層級設定</span>
          </div>
          <div className="init-tree-row">
            <span className="init-tree-line">└──</span>
            <span className="init-tree-name">pipelines/</span>
            <span className="init-tree-cmt">每條一檔，tickets 內嵌</span>
          </div>
        </div>
      </div>

      {!project.hasGit && (
        <div className="init-tree-wrap init-tree-wrap--no-top">
          <label className="mono init-git-toggle">
            <input
              type="checkbox"
              checked={alsoGitInit}
              onChange={(e) => setAlsoGitInit(e.target.checked)}
              disabled={busy}
            />
            <span>順便跑 <code className="init-inline-code">git init</code>（建立空 repo，預設 branch 為 main）</span>
          </label>
        </div>
      )}

      {busy && (
        <p
          id={busyHintId}
          className="mono init-busy-hint"
          role="status"
          aria-live="polite"
        >
          建立中…若超過 30 秒沒回應，請保留此視窗並檢查 backend log（失敗會以 toast 顯示）。
        </p>
      )}

      <div className="init-foot" aria-busy={busy || undefined}>
        <button type="button" className="btn" onClick={onDismiss} disabled={busy}>
          稍後再說
        </button>
        <span className="init-foot-spacer" />
        <div className="init-popup-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={autoInit}
            disabled={busy}
            aria-busy={busy || undefined}
            aria-live="polite"
          >
            {busy ? (
              <>
                <SpinnerIcon /> 建立中…
              </>
            ) : (
              <>
                <RefreshIcon /> 自動初始化
              </>
            )}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

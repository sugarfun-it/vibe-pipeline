import { useState } from "react";
import { ChevronRightIcon, CloseIcon, FolderQuestionIcon, RefreshIcon, SpinnerIcon } from "../../ui/icons";
import * as api from "../../api/projects";
import type { Project } from "../../../shared/types";
import { useToast } from "../../ui/Toast";
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
  const [busy, setBusy] = useState(false);
  const [alsoGitInit, setAlsoGitInit] = useState(true);

  async function autoInit() {
    if (busy) return;
    setBusy(true);
    try {
      let p = project;
      if (!p.hasGit && alsoGitInit) {
        p = await api.gitInit(p.hash);
      }
      const next = await api.init(p.hash);
      onInitialized(next);
    } catch (e) {
      toast(`初始化失敗:${e instanceof Error ? e.message : String(e)}`, { variant: "danger" });
      setBusy(false);
    }
  }

  return (
    <div className="init-popup-overlay" role="dialog" aria-modal="true">
      <div className="init-card fade-up">
        <div className="init-scan">
          <div className="init-scan-icon">
            <FolderQuestionIcon />
          </div>
          <div className="init-scan-text mono">
            <div className="init-scan-status">
              <span style={{ opacity: 0.65 }}>這個專案還沒初始化</span>
            </div>
            <div className="init-scan-path">{project.path}</div>
            <div className="init-scan-miss">
              <span style={{ color: "var(--accent)", display: "inline-flex" }} aria-hidden><CloseIcon /></span>{" "}
              找不到 <code className="init-inline-code">.vibe-pipeline/</code>
            </div>
            {!project.hasGit && (
              <div className="init-scan-miss">
                <span style={{ color: "var(--accent)", display: "inline-flex" }} aria-hidden><CloseIcon /></span>{" "}
                找不到 <code className="init-inline-code">.git/</code>(runner 階段需要)
              </div>
            )}
          </div>
        </div>

        <div className="init-body">
          <h1 className="init-title">要在這個專案初始化 vibe-pipeline 嗎?</h1>
          <p className="init-desc">
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
              <span className="init-tree-cmt">每條一檔,tickets 內嵌</span>
            </div>
          </div>
        </div>

        {!project.hasGit && (
          <div className="init-tree-wrap" style={{ paddingTop: 0 }}>
            <label className="mono init-git-toggle">
              <input
                type="checkbox"
                checked={alsoGitInit}
                onChange={(e) => setAlsoGitInit(e.target.checked)}
                disabled={busy}
              />
              <span>順便跑 <code className="init-inline-code">git init</code>(產 main branch,空 repo)</span>
            </label>
          </div>
        )}

        <div className="init-foot">
          <button type="button" className="btn" onClick={onDismiss} disabled={busy}>
            稍後再說
          </button>
          <span className="init-foot-spacer" />
          <div className="init-popup-actions">
            <button type="button" className="btn btn-primary" onClick={autoInit} disabled={busy}>
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
      </div>
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as api from "../../../api";
import { useCopiedFeedback } from "../../../hooks/useCopiedFeedback";
import { Overlay } from "../../../ui/Overlay";
import { useToast } from "../../../ui/Toast";
import "../../../styles/drawer.css";
import "./diffModal.css";
import { DiffFileContent } from "./DiffFileContent";
import { DiffFileList } from "./DiffFileList";
import { DiffModalHeader } from "./DiffModalHeader";
import { DiffModalStatusStates } from "./DiffModalStatusStates";
import { cssEscape, humanizeUserMsg, parseErrorMessage, slug } from "./diffHelpers";

export function DiffModal({
  projectHash,
  pipelineId,
  pipelineBranch,
  baseBranch,
  onClose,
}: {
  projectHash: string;
  pipelineId: string;
  pipelineBranch: string;
  baseBranch: string;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<api.FullDiff | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const { toast } = useToast();
  // 目前定位中的檔案 path(點 file row 時設定),畫上 active 視覺指示;
  // 不用 hash 路由 — modal 內導覽不該動瀏覽器 URL / history(雷:Esc / 上一頁語意被綁架)。
  const [activeFile, setActiveFile] = useState<string | null>(null);
  // fetch reload token — 「重新讀取」按鈕 +1 觸發 effect 重跑
  const [reloadToken, setReloadToken] = useState(0);
  // 「複製 diff」短暫回饋。原本 1.5s,mobile 一眼瞄回 diff body 就消失(issue copied-interaction-001);
  // 拉到 2.2s 留足 glance window。
  const { copied, flash: flashCopied } = useCopiedFeedback(2200);
  // 把 user-facing humanized message 也存進 state,err block 才能直接顯示而非只靠 toast(error-001 / error-002 / error-003)
  const [errMsg, setErrMsg] = useState<{ user: string; tech: string } | null>(null);
  // 等待超過 ~4s 切換 copy 成「仍在讀取…」— 給 user 一個「沒當機」訊號(interaction-loading-002)
  const [longWait, setLongWait] = useState(false);
  const titleId = useId();
  const branchId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is an intentional refetch trigger
  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setLoadFailed(false);
    setErrMsg(null);
    setLongWait(false);
    const longWaitTimer = setTimeout(() => {
      if (!cancelled) setLongWait(true);
    }, 4000);
    api
      .getFullDiff(projectHash, pipelineId)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadFailed(true);
        // 拆 user msg + tech detail。modal 內顯示 user msg(辨識度高 → user 不用追 toast),tech 折疊在 details
        // (error-001 / error-004)。toast 不再開以避免雙 alert 同時宣告(error-002 / error-003)。
        const parts = parseErrorMessage(e.message);
        setErrMsg({ user: humanizeUserMsg(parts.userMsg), tech: parts.techDetail });
      });
    return () => {
      cancelled = true;
      clearTimeout(longWaitTimer);
    };
  }, [projectHash, pipelineId, reloadToken, toast]);

  // 點檔案列 → modal 內捲動到對應 block;不動 URL hash(避免污染 history / back button)。
  function jumpToFile(path: string) {
    setActiveFile(path);
    const id = "diff-file-" + slug(path);
    const target = contentRef.current?.querySelector<HTMLElement>("#" + cssEscape(id));
    const scroller = contentRef.current;
    if (target && scroller) {
      // 用相對 offset 而非 scrollIntoView,避免 modal 周圍 page 被連帶捲動
      const offset = target.offsetTop - scroller.offsetTop;
      scroller.scrollTo({ top: offset, behavior: "smooth" });
    }
  }

  // 把 aria-busy 直接打在 dialog surface 上 — SR 一打開就知道內容尚未 ready(a11y-loading-001)。
  // 不在 Overlay 元件加 prop 避免改動 cross-component scaffold(scope 控在本檔)。
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!diff && !loadFailed) el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
  }, [diff, loadFailed]);

  // 載入後尚未點任何 file,顯示第一個檔案為 active(scroll position 預設在頂端,跟 UI 一致)。
  useEffect(() => {
    if (!activeFile && diff && diff.files.length > 0) {
      setActiveFile(diff.files[0].path);
    }
  }, [diff, activeFile]);

  // 手動捲動時 → IntersectionObserver 找最靠近 scroller 頂端的 file block,
  // 更新 activeFile,讓 file list 同步反白(沒這層,user 捲到中段不知道現在看哪份)。
  useEffect(() => {
    if (!diff || diff.files.length === 0) return;
    const scroller = contentRef.current;
    if (!scroller) return;
    const blocks = Array.from(
      scroller.querySelectorAll<HTMLElement>(".diff-modal-file-block")
    );
    if (blocks.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const topId = visible[0].target.id; // diff-file-<slug>
        const match = diff.files.find((f) => "diff-file-" + slug(f.path) === topId);
        if (match) setActiveFile((cur) => (cur === match.path ? cur : match.path));
      },
      // 0px top, -75% bottom → 只 fire 當 block 進入頂端 25%(避免大範圍同時 intersect 抖動)
      { root: scroller, rootMargin: "0px 0px -75% 0px", threshold: 0 }
    );
    blocks.forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [diff]);

  const totals = useMemo(() => {
    if (!diff) return { added: 0, deleted: 0 };
    let added = 0;
    let deleted = 0;
    for (const f of diff.files) {
      added += f.added;
      deleted += f.deleted;
    }
    return { added, deleted };
  }, [diff]);
  const addedTotal = totals.added;
  const deletedTotal = totals.deleted;

  function retry() {
    setReloadToken((n) => n + 1);
  }

  function copyRawDiff() {
    // 直接複製 server 回傳的原始 git diff,維持完整可貼回 patch 工具。
    // copied-interaction-002:fallback 也炸時要讓 user 知道,丟 toast danger。
    if (!diff?.raw) return;
    const text = diff.raw;
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) flashCopied();
        else toast("複製失敗，請手動選取差異內容。", { variant: "danger" });
      } catch {
        toast("複製失敗，請手動選取差異內容。", { variant: "danger" });
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => flashCopied()).catch(fallback);
    } else {
      fallback();
    }
  }

  // Overlay portal=true(預設):跳出 ReadyBanner 的 transform containing block(.fade-up 會困住 position:fixed)
  // initialFocus="close":優先 focus close button(stable selector);loading 時 close 仍是第一個可互動元素。
  // is-terminal-state:loading / empty / error 三個 terminal state 加 class,讓 CSS 收縮 modal 尺寸,
  // 不再「整片大白底配一行訊息」(rwd-loading-001 / rwd-empty-001 / visual-empty-001 / error-005 / error-006)。
  const isLoading = !diff && !loadFailed;
  const isEmpty = !!diff && diff.files.length === 0;
  const isTerminal = isLoading || isEmpty || loadFailed;
  return (
    <Overlay
      onRequestClose={onClose}
      labelledBy={titleId}
      describedBy={branchId}
      initialFocus="close"
      stageClassName="drawer-stage--modal diff-modal-stage"
      scrimClassName="diff-modal-scrim"
      surfaceClassName={"drawer--modal diff-modal fade-up" + (isTerminal ? " is-terminal-state" : "")}
      surfaceRef={dialogRef}
    >
      <DiffModalHeader
        titleId={titleId}
        branchId={branchId}
        pipelineBranch={pipelineBranch}
        baseBranch={baseBranch}
        diff={diff}
        addedTotal={addedTotal}
        deletedTotal={deletedTotal}
        copied={copied}
        onCopyRaw={copyRawDiff}
        onClose={onClose}
      />
      <DiffModalStatusStates
        loadFailed={loadFailed}
        diff={diff}
        errMsg={errMsg}
        longWait={longWait}
        baseBranch={baseBranch}
        onRetry={retry}
        copied={copied}
      />
      {diff && diff.files.length > 0 && (
        <div
          className={
            "diff-modal-body" + (diff.files.length === 1 ? " is-single-file" : "")
          }
        >
          <DiffFileList files={diff.files} activeFile={activeFile} onJumpToFile={jumpToFile} />
          <DiffFileContent raw={diff.raw} contentRef={contentRef} />
        </div>
      )}
    </Overlay>
  );
}

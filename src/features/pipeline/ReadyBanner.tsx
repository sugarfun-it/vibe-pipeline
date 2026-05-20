import { CheckCircleIcon, MergeIcon } from "../../ui/icons";
import { useConfirm } from "../../ui/ConfirmDialog";
import type { Pipeline } from "../../types/pipeline";

export function ReadyBanner({
  pipeline,
  onMerge,
}: {
  pipeline: Pipeline;
  onMerge?: (id: string) => void;
}) {
  const confirm = useConfirm();
  const commitCount = pipeline.tickets.reduce(
    (sum, t) => sum + (t.commits?.length ?? 0),
    0
  );
  const baseBranch = pipeline.baseBranch || "main";
  const isMerged = pipeline.state === "merged";
  const failedMerge = pipeline.tickets.find(
    (t) =>
      t.mode === "merge" &&
      (t.status === "failed" ||
        t.status === "failed_iter_limit" ||
        t.status === "failed_transient" ||
        t.status === "paused")
  );
  // 正在跑 AI merge ticket(append 後 ready / running)→ banner 切「合併中」+ button 收起,
  // 避免「✓ ... 可以合併進 main」字樣繼續顯示讓 user 誤判成「合併成功」
  const mergingTicket = pipeline.tickets.find(
    (t) => t.mode === "merge" && (t.status === "ready" || t.status === "running")
  );
  const isMerging = !!mergingTicket && !isMerged;

  return (
    <div
      className={
        "banner fade-up " +
        (isMerged ? "banner-ready" : failedMerge || isMerging ? "banner-paused" : "banner-ready")
      }
    >
      <span
        className="banner-icon"
        style={{
          color: isMerged
            ? "var(--fg-mute)"
            : failedMerge
            ? "var(--failed)"
            : isMerging
            ? "var(--running)"
            : "var(--done)",
        }}
      >
        <CheckCircleIcon />
      </span>
      <div className="banner-body">
        <div className="banner-title">
          {isMerged
            ? `已合併入 ${baseBranch}`
            : failedMerge
            ? `合併失敗 — 點下方重試或先處理 working tree`
            : isMerging
            ? `⏳ AI 合併中(撞衝突,正在解 — 約 2 分鐘)…`
            : `所有 ticket 都 ✓ — 可以合併進 ${baseBranch}`}
        </div>
        <div className="banner-desc mono">
          {pipeline.branch} → {baseBranch} · {commitCount} commit{commitCount === 1 ? "" : "s"}
        </div>
      </div>
      {onMerge && !isMerged && !isMerging && (
        <button type="button"
          className="btn btn-primary"
          onClick={async () => {
            const isRetry = !!failedMerge;
            const ok = await confirm({
              title: isRetry
                ? `重試合併 ${pipeline.branch} → ${baseBranch}?`
                : `合併 ${pipeline.branch} → ${baseBranch}?`,
              description:
                `策略:先試純 git merge --no-ff(無 AI、毫秒級);撞衝突才 fallback 走 AI 全套(spawn runner + sub-agent 解 + 驗證)。\n\n` +
                (isRetry
                  ? `會清掉舊 lastAutoMergeError + 重跑流程。\n` +
                    `若是 working tree 髒導致失敗,先 commit / stash 再重試,不然又 FAIL。`
                  : `clean case 90% 場景秒結束,不燒 token。`),
              confirmLabel: isRetry ? "重試合併" : `合併入 ${baseBranch}`,
            });
            if (ok) onMerge(pipeline.id);
          }}
          title={
            failedMerge
              ? "重試合併(先試 git,撞衝突 fallback AI)"
              : `合併 ${pipeline.branch} → ${baseBranch}(先試 git,撞衝突 fallback AI)`
          }
        >
          <MergeIcon /> {failedMerge ? "重試合併" : `合併入 ${baseBranch}`}
        </button>
      )}
    </div>
  );
}

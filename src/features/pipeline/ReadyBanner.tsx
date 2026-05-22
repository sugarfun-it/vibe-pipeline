import { CheckCircleIcon, MergeIcon, SpinnerIcon, WarnIcon } from "../../ui/icons";
import { useConfirm } from "../../ui/ConfirmDialog";
import type { Pipeline } from "../../types/pipeline";

type BannerVariant = "ready" | "merged" | "merging" | "failed";

const M = {
  merged: (base: string) => `已合併入 ${base}`,
  failedWithRetry: "合併失敗 — 修正 working tree 後重試",
  failedNoAction: "合併失敗 — 請先修正 working tree",
  merging: "正在合併,處理衝突中",
  ready: (base: string) => `所有 ticket 都完成 — 可以合併進 ${base}`,
  commits: (n: number) => `${n} 個 commit`,
};

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
  const mergingTicket = pipeline.tickets.find(
    (t) => t.mode === "merge" && (t.status === "ready" || t.status === "running")
  );
  const isMerging = !!mergingTicket && !isMerged;

  const variant: BannerVariant = isMerged
    ? "merged"
    : isMerging
    ? "merging"
    : failedMerge
    ? "failed"
    : "ready";

  const variantClass =
    variant === "merged"
      ? "banner-ready banner-merged"
      : variant === "ready"
      ? "banner-ready"
      : "banner-paused";

  const iconColor =
    variant === "merged"
      ? "var(--fg-mute)"
      : variant === "failed"
      ? "var(--failed)"
      : variant === "merging"
      ? "var(--running)"
      : "var(--done)";

  const Icon =
    variant === "failed" ? WarnIcon : variant === "merging" ? SpinnerIcon : CheckCircleIcon;

  const hasRetry = variant === "failed" && !!onMerge;
  const title =
    variant === "merged"
      ? M.merged(baseBranch)
      : variant === "failed"
      ? hasRetry
        ? M.failedWithRetry
        : M.failedNoAction
      : variant === "merging"
      ? M.merging
      : M.ready(baseBranch);

  const liveRole =
    variant === "failed"
      ? "alert"
      : variant === "merging"
      ? "status"
      : "group";
  const ariaLive =
    variant === "failed"
      ? "assertive"
      : variant === "merging"
      ? "polite"
      : undefined;
  const showButton = !!onMerge && (variant === "ready" || variant === "failed");

  return (
    <div
      className={`banner fade-up ${variantClass}`}
      data-state={variant}
      role={liveRole}
      aria-live={ariaLive}
      aria-label={variant === "merged" || variant === "ready" ? title : undefined}
      aria-busy={variant === "merging" ? true : undefined}
    >
      <span className="banner-icon" aria-hidden="true" style={{ color: iconColor }}>
        <Icon />
      </span>
      <div className="banner-body">
        <div className="banner-title">{title}</div>
        <div className="banner-desc mono">
          {pipeline.branch} → {baseBranch} · {M.commits(commitCount)}
        </div>
      </div>
      {showButton && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            const isRetry = variant === "failed";
            const ok = await confirm({
              title: isRetry
                ? `重試合併 ${pipeline.branch} → ${baseBranch}?`
                : `合併 ${pipeline.branch} → ${baseBranch}?`,
              description: isRetry
                ? `將清除上次失敗紀錄並重新嘗試合併。\n\n` +
                  `若上次因 working tree 有未提交變更而失敗,請先 commit 或 stash 再重試,否則會再次失敗。`
                : `會先嘗試一般合併;若遇到衝突,系統會自動由 AI 協助解決。\n\n` +
                  `多數情況下會直接成功,不需要進一步操作。`,
              confirmLabel: isRetry ? "重試合併" : `合併入 ${baseBranch}`,
            });
            if (ok) onMerge?.(pipeline.id);
          }}
        >
          <MergeIcon /> {variant === "failed" ? "重試合併" : `合併入 ${baseBranch}`}
        </button>
      )}
    </div>
  );
}

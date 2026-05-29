// RailItem + feature 邏輯(ticket-status→色映射 / merge 文案 / 活動時間推導 / aria-label 推導)。
// 從 src/shell/Rail.tsx 搬過來 —— shell/Rail 只留通用 slotted 容器負責版面,feature 細節歸 features/。
import { STATE_LABEL, railMiniFill } from "../../../lib/pipelines";
import { formatAgo } from "../../../lib/format";
import type { Pipeline } from "../../../../shared/types";
import "./rail.css";

export function RailItem({
  p,
  active,
  onClick,
  muted,
  hasDraft,
}: {
  p: Pipeline;
  active: boolean;
  onClick: () => void;
  muted?: boolean;
  hasDraft?: boolean;
}) {
  const done = p.tickets.filter((t) => t.status === "done").length;
  const total = p.tickets.length;
  const stateText = STATE_LABEL[p.state] ?? p.state;
  const secondary = railSecondary(p);
  const fullSecondary = railSecondaryAccessible(p);
  const miniLabel = railMiniLabel(p);
  const ariaLabel =
    `${p.name} · ${stateText} · ${done} / ${total} ticket 完成` +
    (hasDraft ? " · QA 進行中" : "") +
    (fullSecondary ? ` · ${fullSecondary}` : "") +
    (miniLabel ? ` · ${miniLabel}` : "");
  return (
    <button
      type="button"
      className={"rail-item" + (active ? " is-active" : "") + (muted ? " is-muted" : "")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      aria-disabled={muted ? true : undefined}
      tabIndex={muted ? -1 : undefined}
    >
      <div className="rail-item-row">
        <span
          className={"rail-status-chip" + (p.state === "running" ? " is-running" : "")}
          data-state={p.state}
          aria-hidden="true"
          title={stateText}
        >
          {stateText}
        </span>
        <span className="rail-item-name" title={p.name}>{p.name}</span>
        {hasDraft && (
          <span className="mono rail-qa-badge" aria-hidden="true" title="進行中 QA">
            QA
          </span>
        )}
        <span
          className="rail-item-count mono"
          aria-hidden="true"
          title={`${done} / ${total} ticket 已完成`}
        >
          {done}/{total}
        </span>
      </div>
      <div className="rail-mini" aria-hidden="true">
        {p.tickets.map((t) => (
          <span
            key={t.id}
            className={"rail-mini-cell" + (t.status === "running" ? " is-running" : "")}
            style={{ background: railMiniFill(t.status) }}
          />
        ))}
      </div>
      <div className="rail-item-meta" aria-hidden="true" title={fullSecondary || secondary}>
        <span className="mono">{secondary}</span>
      </div>
    </button>
  );
}

// 第二行 state-aware:用明確中文表 merge 狀態,不用「→」避免被當「已合併」。
function railSecondary(p: Pipeline): string {
  const base = p.baseBranch || "main";
  const branchSuffix = p.branch.replace(/^pipeline\//, "");
  const ago = formatAgo(lastActivityAt(p));
  const agoSuffix = ago ? ` · ${ago}` : "";

  if (p.state === "running") {
    const t = p.tickets.find((x) => x.status === "running");
    if (t) {
      const title = t.title.length > 18 ? t.title.slice(0, 17) + "…" : t.title;
      return `▶ #${t.n} ${title}${agoSuffix}`;
    }
    return `執行中${agoSuffix}`;
  }
  if (p.state === "merged") return `已併入 ${base}${agoSuffix}`;
  if (p.state === "ready") return `可合併入 ${base}${agoSuffix}`;
  if (p.state === "failed") return `失敗${agoSuffix}`;
  if (p.state === "paused") {
    const last = [...p.tickets].reverse().find(
      (x) => x.status === "paused" || x.status === "running"
    );
    if (last) return `⏸ #${last.n}${agoSuffix}`;
    return `暫停${agoSuffix}`;
  }
  // planning(或未知 state):明確標「尚未執行」+ 更新時間,branch 跟 name 不同才補 branch。
  // 沒 activity 時 fallback 到 createdAt(剛建好的 pipeline 也能顯示 "剛剛 / N 分鐘前"),避免
  // 「idle 草稿 vs stale 草稿」在 rail 看起來一樣。
  const planningAgo = ago ? `更新於 ${ago}` : (p.createdAt ? `建立於 ${formatAgo(p.createdAt) || "剛剛"}` : "");
  if (branchSuffix !== p.name) {
    return planningAgo ? `⎇ ${branchSuffix} · ${planningAgo}` : `⎇ ${branchSuffix}`;
  }
  return planningAgo ? `尚未執行 · ${planningAgo}` : "尚未執行";
}

// 同 railSecondary 但符號展開成中文,供 aria-label 用;visual 仍走 railSecondary。
function railSecondaryAccessible(p: Pipeline): string {
  const base = p.baseBranch || "main";
  const branchSuffix = p.branch.replace(/^pipeline\//, "");
  const ago = formatAgo(lastActivityAt(p));
  const agoSuffix = ago ? ` · ${ago}` : "";

  if (p.state === "running") {
    const t = p.tickets.find((x) => x.status === "running");
    if (t) {
      const title = t.title.length > 18 ? t.title.slice(0, 17) + "…" : t.title;
      return `執行中 ticket #${t.n} ${title}${agoSuffix}`;
    }
    return `執行中${agoSuffix}`;
  }
  if (p.state === "merged") return `已併入 ${base}${agoSuffix}`;
  if (p.state === "ready") return `可合併入 ${base}${agoSuffix}`;
  if (p.state === "failed") return `失敗${agoSuffix}`;
  if (p.state === "paused") {
    const last = [...p.tickets].reverse().find(
      (x) => x.status === "paused" || x.status === "running"
    );
    if (last) return `暫停於 ticket #${last.n}${agoSuffix}`;
    return `暫停${agoSuffix}`;
  }
  const planningAgo = ago ? `更新於 ${ago}` : "";
  if (branchSuffix !== p.name) {
    return planningAgo ? `branch ${branchSuffix} · ${planningAgo}` : `branch ${branchSuffix}`;
  }
  return planningAgo ? `尚未執行 · ${planningAgo}` : "尚未執行";
}

// rail-mini 的 aria-label:把 ticket status 分布念給 screen reader,不只靠顏色
function railMiniLabel(p: Pipeline): string {
  const total = p.tickets.length;
  if (total === 0) return "尚無 ticket";
  const counts: Record<string, number> = {};
  for (const t of p.tickets) {
    const k =
      t.status === "failed" ||
      t.status === "failed_iter_limit" ||
      t.status === "failed_transient"
        ? "failed"
        : t.status;
    counts[k] = (counts[k] || 0) + 1;
  }
  const label: Record<string, string> = {
    done: "已完成",
    running: "執行中",
    paused: "暫停",
    ready: "準備",
    failed: "失敗",
  };
  const parts: string[] = [];
  for (const k of ["done", "running", "paused", "ready", "failed"]) {
    if (counts[k]) parts.push(`${counts[k]} ${label[k]}`);
  }
  const known = parts.length ? parts.join("、") : "";
  const planned = total - (counts.done || 0) - (counts.running || 0) - (counts.paused || 0) - (counts.ready || 0) - (counts.failed || 0);
  const tail = planned > 0 ? (known ? `、${planned} 待執行` : `${planned} 待執行`) : "";
  return `共 ${total} ticket${known || tail ? "(" + known + tail + ")" : ""}`;
}

function lastActivityAt(p: Pipeline): number | null {
  let max = 0;
  for (const t of p.tickets) {
    if (typeof t.endedAt === "number") max = Math.max(max, t.endedAt);
    if (typeof t.startedAt === "number") max = Math.max(max, t.startedAt);
    if (t.iter?.rounds) {
      for (const r of t.iter.rounds) {
        if (typeof r.endedAt === "number") max = Math.max(max, r.endedAt);
        if (typeof r.startedAt === "number") max = Math.max(max, r.startedAt);
      }
    }
    if (t.commits) {
      for (const c of t.commits) {
        if (c && typeof c.ts === "number") max = Math.max(max, c.ts);
      }
    }
  }
  return max > 0 ? max : null;
}

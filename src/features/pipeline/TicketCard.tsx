import { STATE_COLOR, TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, fmtElapsed } from "../../data/pipelines";
import { MODE_LABELS } from "../../api/qa";
import { IterStages } from "./IterStages";
import type { IterStage, Ticket, TicketStatus } from "../../types/pipeline";

export function TicketCard({
  ticket,
  tick,
  index,
  isSplitting = false,
  onClick,
}: {
  ticket: Ticket;
  tick: number;
  index: number;
  isSplitting?: boolean;
  onClick?: () => void;
}) {
  // merge / sync ticket 也跟 iter 一樣有 iter.rounds 結構,渲染走同分支
  const isIter = ticket.mode === "iter" || ticket.mode === "merge" || ticket.mode === "sync";
  // 但 merge / sync 沒真的 critic AI(sub-agent 自己跑驗證自己回 PASS/FAIL),
  // UI 不顯「審核」階段,直接 doer → 結果 兩段
  const hasCritic = ticket.mode === "iter";
  const stageList: IterStage[] = hasCritic ? ["doer", "critic", "✓"] : ["doer", "✓"];
  const isRunning = ticket.status === "running";
  const isPaused = ticket.status === "paused";
  // draft / ready 統一視為「未執行」,共用 is-draft 樣式(opacity 偏淡)
  const isDraft = ticket.status === "draft" || ticket.status === "ready";

  // Round-sum 計時:已完成 round 累加 + in-progress round live(到 Date.now())。
  // 避免 wall-clock 把暫停 / 跨日的閒置時間也算進去(觀感「6 小時還沒跑完」其實多半在等 user)。
  // tick 當 re-render 訊號,使 in-progress round 每秒重算
  void tick;
  let elapsed: number;
  const rs = ticket.iter?.rounds ?? [];
  if (rs.length > 0) {
    // 完成 round 的定義跟下方 IterRounds 渲染一致:endedAt + criticVerdict 都有才算完成
    // (runner 提早寫 endedAt 但 verdict 還空,該 round 仍視為進行中)
    const completedSec = rs.reduce(
      (sum, r) =>
        sum + (r.endedAt && r.criticVerdict && r.startedAt ? Math.max(0, r.endedAt - r.startedAt) : 0),
      0
    ) / 1000;
    const inProg = rs.find((r) => !r.endedAt || !r.criticVerdict);
    const liveSec = isRunning && inProg?.startedAt
      ? Math.max(0, (Date.now() - inProg.startedAt) / 1000)
      : 0;
    elapsed = Math.round(completedSec + liveSec);
  } else {
    const ts = (ticket as { startedAt?: number; endedAt?: number }).startedAt;
    const te = (ticket as { startedAt?: number; endedAt?: number }).endedAt;
    if (typeof ts === "number") {
      const end = isRunning ? Date.now() : (te ?? Date.now());
      elapsed = Math.max(0, Math.round((end - ts) / 1000));
    } else {
      elapsed = ticket.iter?.totalElapsed ?? 0;
    }
  }
  const iterCurrentLabel = ticket.iter ? Math.max(1, ticket.iter.current) : 0;
  const accent = TICKET_STATUS_COLOR[ticket.status] || "var(--draft)";

  return (
    // ticket card 內含 chips + action button,不能用 <button> wrap(invalid HTML),
    // 改 div + role="button" + onKeyDown 已具備鍵盤可達性
    // biome-ignore lint/a11y/noStaticElementInteractions: clickable card with nested buttons
    <div
      className={"ticket"
        + (isDraft ? " is-draft" : "")
        + (isPaused ? " is-paused" : "")
        + (isRunning ? " is-running" : "")
        + (ticket.status === "done" ? " is-done" : "")
        + (ticket.status === "failed" || ticket.status === "failed_iter_limit" || ticket.status === "failed_transient" ? " is-failed" : "")
        + (isSplitting ? " is-splitting" : "")}
      style={{ animationDelay: `${index * 40}ms`, cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <span className="ticket-band" style={{ background: accent }} />

      <div className="ticket-row">
        <span className="ticket-num mono">{String(ticket.n).padStart(2, "0")}</span>
        <div className="ticket-title">{ticket.title}</div>

        <span className={"chip ticket-mode" + (isIter ? " is-iter" : "")}>
          {MODE_LABELS[ticket.mode as "step" | "iter" | "merge" | "sync"] ?? ticket.mode}
        </span>

        {isSplitting ? (
          <span className="chip ticket-splitting">
            <span className="ticket-splitting-spinner" aria-hidden />
            AI 拆分中
          </span>
        ) : (
          <StatusPill status={ticket.status} />
        )}

        {ticket.meta && !isIter && <span className="ticket-meta mono">{ticket.meta}</span>}
      </div>

      {ticket.goal && <div className="ticket-goal">{ticket.goal}</div>}

      {/* iter row / stage chip 只在有跑過(rounds 非空)或執行 / 完成 / 失敗狀態才顯示。
          ready / draft 即使 backend 預建 iter={rounds:[],...} 也不渲染,避免誤判執行中。*/}
      {isIter && ticket.iter &&
        ((ticket.iter.rounds?.length ?? 0) > 0 ||
          ticket.status === "running" ||
          ticket.status === "paused" ||
          ticket.status === "done" ||
          ticket.status === "failed" ||
          ticket.status === "failed_iter_limit" ||
          ticket.status === "failed_transient") && (() => {
        const rounds = ticket.iter.rounds ?? [];
        const inProgress =
          (ticket.status === "running" || ticket.status === "paused") &&
          // stage 不是 ✓:那 round 還沒收尾,顯示 in-progress 列
          ticket.iter.stage !== "✓" &&
          ticket.iter.stage !== "done";
        return (
          <>
            {/* 「完成」收緊定義:endedAt 真有值 + criticVerdict 真有值(runner 偶發提早寫 endedAt 但 verdict 還空,
                舊版只看 endedAt → 那條會被誤算完成又被 inProgress 重複渲染 = #2 雙顯) */}
            {rounds.filter((r) => r.endedAt && r.criticVerdict).map((r) => (
              <div key={r.n} className="ticket-iter ticket-iter-row">
                <span className="iter-round-num mono">#{r.n}</span>
                <IterStages
                  stage="✓"
                  status="done"
                  stages={stageList}
                  lastVerdict={r.criticVerdict}
                />
                <span className="iter-meta mono">
                  {r.startedAt
                    ? fmtElapsed(Math.round((r.endedAt! - r.startedAt) / 1000))
                    : "—"}
                </span>
              </div>
            ))}
            {inProgress && (() => {
              // in-progress round = rounds 內最後一筆「endedAt 沒有 或 verdict 空」(代表 critic 還沒判完),
              // 沒這種 entry 就 fallback ticket.startedAt
              const inProg = rounds.find((r) => !r.endedAt || !r.criticVerdict);
              const completed = rounds.filter((r) => r.endedAt && r.criticVerdict);
              const lastEnded = completed[completed.length - 1]?.endedAt;
              const roundStart = inProg?.startedAt ?? lastEnded ?? (ticket as { startedAt?: number }).startedAt;
              const live = typeof roundStart === "number"
                ? Math.max(0, Math.round((Date.now() - roundStart) / 1000))
                : 0;
              return (
                <div className="ticket-iter ticket-iter-row">
                  <span className="iter-round-num mono">
                    #{inProg?.n ?? (ticket.iter?.current ?? 0) + 1}
                  </span>
                  <IterStages
                    stage={ticket.iter!.stage}
                    status={ticket.status}
                    stages={stageList}
                  />
                  <span className="iter-meta mono">
                    {fmtElapsed(live)}
                  </span>
                </div>
              );
            })()}
            {rounds.length === 0 && !inProgress && (
              // 還沒跑(ready 但 mode=iter/merge/sync 也屬此情形)
              <div className="ticket-iter ticket-iter-row">
                <span className="iter-round-num mono">#1</span>
                <IterStages
                  stage="doer"
                  status={ticket.status}
                  stages={stageList}
                />
              </div>
            )}
            <div className="ticket-iter-summary mono">
              iter <strong>{iterCurrentLabel}</strong> · {fmtElapsed(elapsed)} elapsed
            </div>
          </>
        );
      })()}

      {!isIter && (ticket.status === "running" || ticket.status === "paused" ||
                   ticket.status === "done" || ticket.status === "failed" ||
                   ticket.status === "failed_iter_limit" || ticket.status === "failed_transient") && (
        <div className="ticket-iter ticket-iter-row">
          <span className="iter-round-num mono">#1</span>
          <IterStages
            stage={ticket.status === "done" ? "✓" : "doer"}
            status={ticket.status}
            stages={["doer", "✓"]}
            lastVerdict={
              ticket.status === "done"
                ? "PASS"
                : ticket.status.startsWith("failed")
                ? "FAIL"
                : undefined
            }
          />
          {(() => {
            const sa = ticket.startedAt;
            const ea = ticket.endedAt;
            if (!sa) return null;
            const ms = (ea ?? Date.now()) - sa;
            const live = ticket.status === "running" ? tick : 0;
            return (
              <span className="iter-meta mono">
                {fmtElapsed(Math.round(ms / 1000) + live)}
              </span>
            );
          })()}
        </div>
      )}

      {isRunning && ticket.liveLog && (
        <div className="ticket-livelog mono">
          <span className="livelog-cursor blink">▸</span> {ticket.liveLog}
        </div>
      )}

      {isPaused && ticket.reason && (
        <div className="ticket-paused-actions">
          <span className="paused-reason">{ticket.reason}</span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: TicketStatus }) {
  const c = TICKET_STATUS_COLOR[status] ?? STATE_COLOR[status];
  const label = TICKET_STATUS_LABEL[status] ?? status;
  const isLive = status === "running";
  return (
    <span className="status-pill mono" style={{ color: c }}>
      <span className={"status-pill-dot" + (isLive ? " pulse" : "")} style={{ background: c }} />
      {label}
    </span>
  );
}

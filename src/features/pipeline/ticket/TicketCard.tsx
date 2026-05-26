import { memo } from "react";
import { MODE_LABELS } from "../../../api/qa";
import { fmtElapsed, TICKET_STATUS_COLOR, TICKET_STATUS_LABEL } from "../../../lib/pipelines";
import type { IterStage, Ticket, TicketStatus } from "../../../../shared/types";
import { ChevronRightIcon } from "../../../ui/icons";
import { IterStages } from "../run/IterStages";
import "./ticketCard.css";

export const TicketCard = memo(function TicketCard({
  ticket,
  tick,
  index,
  isSplitting = false,
  onSelect,
}: {
  ticket: Ticket;
  tick: number;
  index: number;
  isSplitting?: boolean;
  onSelect?: (ticket: Ticket) => void;
}) {
  const onClick = onSelect ? () => onSelect(ticket) : undefined;
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
  const isDone = ticket.status === "done";
  const isFailed =
    ticket.status === "failed" ||
    ticket.status === "failed_iter_limit" ||
    ticket.status === "failed_transient";
  const isTerminal = isDone || isFailed;
  // 「完成 round」單一判定:有 endedAt 必要;iter 模式還必須有 criticVerdict;merge/sync 無 critic
  // 不要求 verdict(舊版混用 r.endedAt+r.criticVerdict 會把 merge/sync 已完成 round 永遠當 in-progress)
  const isRoundComplete = (r: { endedAt?: number; criticVerdict?: string }) =>
    Boolean(r.endedAt && (!hasCritic || r.criticVerdict));

  // Round-sum 計時:已完成 round 累加 + in-progress round live(到 Date.now())。
  // 避免 wall-clock 把暫停 / 跨日的閒置時間也算進去(觀感「6 小時還沒跑完」其實多半在等 user)。
  // tick 當 re-render 訊號,使 in-progress round 每秒重算
  void tick;
  let elapsed: number;
  const rs = ticket.iter?.rounds ?? [];
  if (rs.length > 0) {
    const completedSec = rs.reduce(
      (sum, r) =>
        sum + (isRoundComplete(r) && r.startedAt ? Math.max(0, r.endedAt! - r.startedAt) : 0),
      0
    ) / 1000;
    const inProg = rs.find((r) => !isRoundComplete(r));
    // in-progress round 計時上限:
    //   running → Date.now()(實時跑)
    //   terminal(done/failed)→ ticket.endedAt(避免失敗後 timer 還在跑;done 不會走這條,因為 done 的 round 都 complete)
    //   其他(paused / draft)→ 不計 live(只看已完成 round 總和)
    const inProgEndCap = isRunning
      ? Date.now()
      : isTerminal
      ? ((ticket as { endedAt?: number }).endedAt ?? inProg?.endedAt)
      : undefined;
    const liveSec = inProg?.startedAt && typeof inProgEndCap === "number"
      ? Math.max(0, (inProgEndCap - inProg.startedAt) / 1000)
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
  // 顯示 round 編號:有 in-progress round 用它的 n;否則用最後完成 round 的 n;最後 fallback ticket.iter.current。
  // 不直接信 ticket.iter.current(backend 可能在 round 完成後遞增,顯示會超前一格)
  const completedRoundsForLabel = rs.filter((r) => isRoundComplete(r));
  const inProgForLabel = rs.find((r) => !isRoundComplete(r));
  const lastCompletedN = completedRoundsForLabel[completedRoundsForLabel.length - 1]?.n;
  const iterCurrentLabel = ticket.iter
    ? (inProgForLabel?.n ?? lastCompletedN ?? Math.max(1, ticket.iter.current))
    : 0;
  const accent = TICKET_STATUS_COLOR[ticket.status] || "var(--draft)";
  const statusLabel = TICKET_STATUS_LABEL[ticket.status] ?? ticket.status;
  // splitting 是覆蓋 status 的視覺狀態:對 SR 也要回報「AI 拆分中」,不能只報舊 status
  const accessibleState = isSplitting ? "AI 拆分中" : statusLabel;
  const modeLabel = MODE_LABELS[ticket.mode as "step" | "iter" | "merge" | "sync"] ?? ticket.mode;
  // 摘要文案隨 status 變:done/failed 用「共 N 輪 · 總耗時」明示已結束,paused 標示暫停,其他維持「已耗時」
  const summaryText = isTerminal
    ? `共 ${iterCurrentLabel} 輪 · 總耗時 ${fmtElapsed(elapsed)}`
    : isPaused
    ? `第 ${iterCurrentLabel} 輪 · 已暫停 · 已耗時 ${fmtElapsed(elapsed)}`
    : `第 ${iterCurrentLabel} 輪 · 已耗時 ${fmtElapsed(elapsed)}`;
  // TICKET-006:單輪 terminal ticket 的 round row 已經帶 elapsed,summary 重複「共 1 輪 · 總耗時」純資訊冗餘 → 隱藏
  const completedRoundCount = rs.filter((r) => isRoundComplete(r)).length;
  const hideSummary = isTerminal && completedRoundCount <= 1 && rs.length <= 1;
  // 完整 accessible name:#NN <title>,<mode>,<state>(+iter 摘要 / paused reason / liveLog)
  // 給 SR user 跟 sighted user 同等資訊密度(原本只有 status,丟失了 mode、goal、進度、暫停原因)
  const ariaLabelParts: string[] = [];
  if (onClick) {
    // tk-009:enriched accessible name — 「開啟 ticket #NN <title>,<mode>,<state>(+ 詳情)」,
    // 讓 SR 一次理解可開啟性 + 結果。
    ariaLabelParts.push(`開啟 ticket #${String(ticket.n).padStart(2, "0")} ${ticket.title}`);
    ariaLabelParts.push(modeLabel);
    ariaLabelParts.push(accessibleState);
    if (ticket.goal) ariaLabelParts.push(ticket.goal);
    if (isIter && ticket.iter &&
        ((ticket.iter.rounds?.length ?? 0) > 0 ||
          isRunning || isPaused || isTerminal)) {
      ariaLabelParts.push(summaryText);
    }
    if (isPaused && ticket.reason) ariaLabelParts.push(`暫停原因:${ticket.reason}`);
    // TICKET-012:liveLog 是高頻 polite live region,已在自己 element 上 announce;
    // 從 card-level ariaLabel 拿掉避免 focus 時整段重複念出 + log 更新時雙重 announce
  }
  const ariaLabel = onClick ? ariaLabelParts.join("，") : undefined;

  return (
    // ticket card 內含 chips + action button,不能用 <button> wrap(invalid HTML),
    // 改 div + role="button" + onKeyDown / onKeyUp 已具備鍵盤可達性
    // biome-ignore lint/a11y/noStaticElementInteractions: clickable card with nested buttons
    <div
      className={"ticket"
        + (onClick ? " is-clickable" : "")
        + (isDraft ? " is-draft" : "")
        + (isPaused ? " is-paused" : "")
        + (isRunning ? " is-running" : "")
        + (ticket.status === "done" ? " is-done" : "")
        + (ticket.status === "failed" || ticket.status === "failed_iter_limit" || ticket.status === "failed_transient" ? " is-failed" : "")
        + (isSplitting ? " is-splitting" : "")}
      style={{
        animationDelay: `${index * 40}ms`,
        cursor: onClick ? "pointer" : undefined,
        // 暴露 accent 給 board.css 用單一 custom property 統一 band / pill / dot 顏色(Phase 4 消費)
        ["--ticket-accent" as string]: accent,
      } as React.CSSProperties}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      onKeyDown={
        onClick
          ? (e) => {
              // Enter 走 keydown 立即觸發;Space 在 keydown 只擋預設捲動,實際 activation 走 keyup
              // 對齊原生 <button> 語意(避免長按連發開兩次 drawer)
              if (e.repeat) return;
              if (e.key === "Enter") {
                e.preventDefault();
                onClick();
              } else if (e.key === " ") {
                e.preventDefault();
              }
            }
          : undefined
      }
      onKeyUp={
        onClick
          ? (e) => {
              if (e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <span className="ticket-band" aria-hidden style={{ background: accent }} />

      {/* tk-001:header grid = [num] [titleline(chip + title)] [trailing(status + chevron)] */}
      <div className="ticket-row ticket-card__header">
        <span className="ticket-num mono">{String(ticket.n).padStart(2, "0")}</span>
        <div className="ticket-card__titleline">
          {modeLabel && (
            <span className={"chip ticket-mode" + (isIter ? " is-iter" : "")}>
              {modeLabel}
            </span>
          )}
          <div className="ticket-title">{ticket.title}</div>
        </div>

        <div className="ticket-card__trailing">
          {isSplitting ? (
            <span className="chip ticket-splitting">
              <span className="ticket-splitting-spinner" aria-hidden />
              AI 拆分中
            </span>
          ) : (
            <StatusPill status={ticket.status} />
          )}
          {onClick && <ChevronRightIcon className="ticket-card__chevron" aria-hidden />}
        </div>
      </div>

      {ticket.meta && !isIter && (
        <div className="ticket-card__sub">
          <span className="ticket-meta mono">{ticket.meta}</span>
        </div>
      )}

      {ticket.goal && <div className="ticket-goal ticket-card__description">{ticket.goal}</div>}

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
        // 顯示「進行中 / 未收尾的當前 round」邏輯:running / paused 必顯;failed 系列若有未完成的 round 也要顯
        // (否則 failed_iter_limit 失敗在某 round 中段時,卡片只剩摘要、看不到失敗時是哪輪的哪個階段)
        const hasIncompleteRound = rounds.some((r) => !isRoundComplete(r));
        const inProgress =
          (ticket.status === "running" || ticket.status === "paused" || isFailed) &&
          hasIncompleteRound &&
          ticket.iter.stage !== "✓" &&
          ticket.iter.stage !== "done";
        return (
          <>
            {rounds.filter((r) => isRoundComplete(r)).map((r) => {
              // tk-002 / tk-004 / tk-010:完成 round 改用 IterStages 同款 chip + arrow,跟進行中視覺一致
              return (
                <div key={r.n} className="ticket-iter ticket-iter-row">
                  <span className="iter-round-num mono">第 {r.n} 輪</span>
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
              );
            })}
            {inProgress && (() => {
              // in-progress round = rounds 內最後一筆未完成的 round
              const inProg = rounds.find((r) => !isRoundComplete(r));
              const completed = rounds.filter((r) => isRoundComplete(r));
              const lastEnded = completed[completed.length - 1]?.endedAt;
              const roundStart = inProg?.startedAt ?? lastEnded ?? (ticket as { startedAt?: number }).startedAt;
              // terminal(失敗系列)時 timer 不再跑 → 用 ticket.endedAt / inProg.endedAt 上限,而不是 Date.now()
              const roundEnd = isTerminal
                ? ((ticket as { endedAt?: number }).endedAt ?? inProg?.endedAt ?? Date.now())
                : Date.now();
              const live = typeof roundStart === "number"
                ? Math.max(0, Math.round((roundEnd - roundStart) / 1000))
                : 0;
              const roundNum = inProg?.n ?? ticket.iter?.current ?? completed.length + 1;
              return (
                <div className="ticket-iter ticket-iter-row">
                  <span className="iter-round-num mono">
                    第 {roundNum} 輪
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
              <div className="ticket-iter ticket-iter-row">
                <span className="iter-round-num mono">第 1 輪</span>
                <IterStages
                  stage="doer"
                  status={ticket.status}
                  stages={stageList}
                />
              </div>
            )}
            {!hideSummary && (
              <div className="ticket-iter-summary mono">
                {summaryText}
              </div>
            )}
          </>
        );
      })()}

      {!isIter && (ticket.status === "running" || ticket.status === "paused" ||
                   ticket.status === "done" || ticket.status === "failed" ||
                   ticket.status === "failed_iter_limit" || ticket.status === "failed_transient") && (() => {
        const sa = ticket.startedAt;
        const ea = ticket.endedAt;
        const ms = sa ? (ea ?? Date.now()) - sa : 0;
        const elapsedStr = sa ? fmtElapsed(Math.max(0, Math.round(ms / 1000))) : null;
        // tk-010:終結狀態跟 running/paused 一律用 IterStages chip + arrow,風格一致;
        // verdict 在 result chip 內以中文顯示(通過 / 失敗)。
        const terminalStage: "doer" | "✓" = isTerminal ? "✓" : "doer";
        const terminalStatus: TicketStatus = isTerminal && ticket.status !== "done" ? "failed" : ticket.status;
        const verdictHint = isTerminal ? (ticket.status === "done" ? "PASS" : "FAIL") : undefined;
        return (
          // step / merge / sync ticket 單次任務,不顯示 round 號(只一輪),用 --single variant
          <div className="ticket-iter ticket-iter-row ticket-iter-row--single">
            <IterStages
              stage={terminalStage}
              status={terminalStatus}
              stages={["doer", "✓"]}
              lastVerdict={verdictHint}
            />
            {elapsedStr && <span className="iter-meta mono">{elapsedStr}</span>}
          </div>
        );
      })()}

      {isRunning && ticket.liveLog && (
        <div
          className="ticket-livelog mono"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="livelog-cursor blink" aria-hidden>▸</span> {ticket.liveLog}
        </div>
      )}

      {(isPaused || isFailed) && ticket.reason && (
        <div className={"ticket-paused-actions" + (isFailed ? " is-failed-reason" : "")}>
          <span className={"paused-reason" + (isFailed ? " is-failed" : "")}>{ticket.reason}</span>
        </div>
      )}
    </div>
  );
});

function StatusPill({ status }: { status: TicketStatus }) {
  const label = TICKET_STATUS_LABEL[status] ?? status;
  const isLive = status === "running";
  return (
    <span className="status-pill mono" data-state={status}>
      <span
        className={"status-pill-dot" + (isLive ? " pulse" : "")}
        aria-hidden
      />
      {label}
    </span>
  );
}

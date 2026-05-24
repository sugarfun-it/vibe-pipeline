/* ============================================================================
 * InboxColumn — JSX SSOT(DOM / className verbatim 對齊 source)
 *
 * 來源:
 *   src/features/notifications/InboxColumn.tsx (521 lines)
 *   src/types/notif.ts                         (NotifItem / InboxState / InboxFilter)
 *   src/data/notifications.ts                  (SEV_COLOR)
 *   src/ui/icons.tsx                           (BellIcon / ChevronRightIcon / CloseIcon / InboxEmptyIcon)
 *   shared/types.ts                            (NotifSeverity / NotifEventType / NOTIF_EVENTS, 43 種 type × 3 sev)
 *
 * 規則:
 *   - className 一字不漏對齊 source
 *   - icons 內聯展開為 <svg>(不引外部),path / viewBox / stroke verbatim
 *   - portal(InboxStrip preview popover)用 ReactDOM.createPortal,target=document.body
 *   - 所有 sev / kind / 文案規則照 source 邏輯(SEV_COLOR / SEV_TEXT / aria 動態組裝)
 *   - mock function 取代 onMarkRead / onDismiss / onItemClick / onMarkAllRead / onDismissAll
 *   - fixture 涵蓋 43 種 NotifEventType,每種至少 1 row,並補 read/unread/blocking variant
 *
 * Demo controls:
 *   - theme(dark/light)、density(normal/compact via root data-attr)
 *   - state(expanded / collapsed / hidden)
 *   - filter(all / unread / blocking,跟 source 內 InboxFilter union 完全一致)
 *   - scenario(8 種:full-43、only-blocking、only-info、only-muted、mixed-some-unread、empty、empty-unread-filter-active、long-titles)
 *   - highlightId(null / 指向某 id)
 *
 * 不在 source 但 prototype 需要的純 shim:
 *   - 假 BoardScreen sidebar / topbar chrome(.proto-rail / .proto-topbar)— 視覺脈絡用
 *   - 所有 callback log 到 console
 * ========================================================================= */

const { useEffect, useRef, useState, useMemo, Fragment } = React;
const { createPortal } = ReactDOM;

// ─── icons(verbatim from src/ui/icons.tsx)──────────────────────────────

function BellIcon(p) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 8a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
function ChevronRightIcon(p) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
function CloseIcon(p) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function InboxEmptyIcon(p) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m4 12 5 5 11-11" />
    </svg>
  );
}

// ─── data dictionaries(verbatim from src/data/notifications.ts + shared/types.ts)

const SEV_COLOR = {
  block: "var(--paused)",
  info: "var(--done)",
  muted: "var(--fg-faint)",
};

const SEV_TEXT = {
  block: "阻斷",
  info: "資訊",
  muted: "一般",
};

// 43 種 NotifEventType + 對應 default sev / label (from shared/types.ts NOTIF_EVENTS)
const NOTIF_EVENTS = {
  project_init: { sev: "muted", phase: "stub-first", label: "Project 初始化完成" },
  pipeline_created: { sev: "muted", phase: "stub-first", label: "Pipeline 建立" },
  pipeline_deleted: { sev: "muted", phase: "stub-first", label: "Pipeline 刪除" },
  pipeline_renamed: { sev: "muted", phase: "stub-first", label: "Pipeline 改名" },
  ticket_added: { sev: "muted", phase: "stub-first", label: "Ticket 加入" },
  ticket_removed: { sev: "muted", phase: "stub-first", label: "Ticket 移除" },
  ticket_status_changed: { sev: "muted", phase: "stub-first", label: "Ticket 狀態變更" },
  pipeline_started: { sev: "muted", phase: "P2", label: "Pipeline 開始運行" },
  pipeline_queued: { sev: "muted", phase: "P2", label: "Pipeline 已排隊" },
  pipeline_paused: { sev: "info", phase: "P2", label: "Pipeline 已暫停" },
  ticket_started: { sev: "muted", phase: "P2", label: "Ticket 開始跑" },
  iter_critic_pass: { sev: "info", phase: "P2", label: "Iteration critic pass" },
  iter_critic_fail: { sev: "muted", phase: "P2", label: "Iteration critic fail(連續 N 次升 block)" },
  ticket_done: { sev: "info", phase: "P2", label: "Ticket done" },
  ticket_failed: { sev: "block", phase: "P2", label: "Ticket failed" },
  pipeline_ready_to_merge: { sev: "info", phase: "P2", label: "Pipeline ready to merge" },
  merge_started: { sev: "muted", phase: "P2", label: "AI 合併開始" },
  merge_blocked: { sev: "block", phase: "P2", label: "AI 合併失敗,需處理" },
  pipeline_auto_merge_started: { sev: "info", phase: "P2", label: "Pipeline 自動合併已觸發" },
  pipeline_merged: { sev: "info", phase: "P2", label: "Pipeline merge 完成" },
  pipeline_merge_cleanup_failed: { sev: "info", phase: "P2", label: "Merge 後 worktree 清理失敗" },
  pipeline_failed: { sev: "block", phase: "P2", label: "Pipeline failed" },
  budget_warn: { sev: "info", phase: "P2", label: "Budget 80% 警告" },
  budget_hard_cap: { sev: "block", phase: "P2", label: "Budget 硬上限" },
  pipeline_blocked_budget: { sev: "block", phase: "P2", label: "Pipeline 被預算上限擋下" },
  runner_stall: { sev: "block", phase: "P2", label: "Runner 卡住" },
  runner_crash: { sev: "block", phase: "P2", label: "Runner crash" },
  sync_started: { sev: "muted", phase: "P2", label: "同步已啟動" },
  sync_conflict: { sev: "block", phase: "P2", label: "同步遇衝突,等 user 決定" },
  sync_succeeded: { sev: "info", phase: "P2", label: "同步完成" },
  sync_failed: { sev: "block", phase: "P2", label: "同步失敗" },
  skill_candidate: { sev: "info", phase: "P3", label: "新 SKILL 候選" },
  cross_pipeline_pattern: { sev: "info", phase: "P3", label: "跨 pipeline 模式偵測" },
  scheduler_fired: { sev: "muted", phase: "P3", label: "排程觸發" },
  frontend_action_failed: { sev: "block", phase: "P2", label: "前端動作失敗" },
  frontend_action_warn: { sev: "info", phase: "P2", label: "前端動作警告" },
  frontend_action_info: { sev: "muted", phase: "P2", label: "前端動作紀錄" },
  system_updating: { sev: "info", phase: "P2", label: "系統更新中(backend 即將重啟)" },
};

// ─── InboxColumn(verbatim from src/features/notifications/InboxColumn.tsx)──

function InboxColumn(props) {
  if (props.state === "hidden") return null;
  if (props.state === "collapsed") {
    return (
      <aside className="inbox-col" aria-label="通知欄已收合" id="inbox-aside">
        <InboxStrip
          items={props.items}
          unreadCount={props.unreadCount}
          onExpand={() => props.setState("expanded")}
          onItemClick={props.onItemClick}
        />
      </aside>
    );
  }
  return (
    <aside className="inbox-col" aria-label="通知欄已展開" id="inbox-aside">
      <InboxPanel {...props} onCollapse={() => props.setState("collapsed")} />
    </aside>
  );
}

function InboxStrip({ items, unreadCount, onExpand, onItemClick }) {
  const SHOW = 12;
  const visible = items.slice(0, SHOW);
  const overflow = Math.max(0, items.length - SHOW);
  const hasItems = visible.length > 0;

  const [previewIdx, setPreviewIdx] = useState(null);
  const pipsRef = useRef(null);
  const [previewPos, setPreviewPos] = useState(null);
  useEffect(() => {
    if (previewIdx === null) {
      setPreviewPos(null);
      return;
    }
    const el = pipsRef.current;
    if (!el) return;
    const dot = el.querySelectorAll(".inbox-strip-pip")[previewIdx];
    const pipsRect = el.getBoundingClientRect();
    const dotRect = dot?.getBoundingClientRect();
    setPreviewPos({
      top: dotRect ? dotRect.top + dotRect.height / 2 : pipsRect.top + pipsRect.height / 2,
      right: window.innerWidth - pipsRect.left + 8,
    });
  }, [previewIdx]);

  useEffect(() => {
    const el = pipsRef.current;
    if (!el) return;
    function onWheel(e) {
      if (visible.length === 0) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      setPreviewIdx((prev) => {
        const cur = prev ?? 0;
        const next = cur + dir;
        if (next < 0) return 0;
        if (next >= visible.length) return visible.length - 1;
        return next;
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [visible.length]);

  const previewItem = previewIdx !== null ? visible[previewIdx] : null;

  const pipsAriaLabel = (() => {
    if (!hasItems) return "通知列表(目前 0 則)";
    const parts = [];
    parts.push(`通知列表,${items.length} 則`);
    if (unreadCount > 0) parts.push(`${unreadCount} 未讀`);
    if (overflow > 0) parts.push(`顯示前 ${SHOW},另有 ${overflow} 則`);
    if (previewItem) {
      parts.push(
        `目前預覽 ${(previewIdx ?? 0) + 1}/${visible.length}:` +
          `${SEV_TEXT[previewItem.sev] ?? ""}通知「${previewItem.title}」` +
          (previewItem.unread ? ",未讀" : ""),
      );
    }
    return parts.join(",");
  })();

  const isCoarsePointer = () => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(pointer: coarse)").matches;
  };

  return (
    <div className="inbox-strip">
      <button
        type="button"
        className={"inbox-strip-bell" + (unreadCount > 0 ? " has-unread" : "")}
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        title={unreadCount > 0 ? `展開通知(${unreadCount} 未讀)` : "展開通知"}
        aria-label={unreadCount > 0 ? `展開通知,${unreadCount} 未讀` : "展開通知"}
        aria-expanded={false}
        aria-controls="inbox-aside"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="inbox-strip-bell-num mono" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      <div className="inbox-strip-divider"></div>

      {hasItems ? (
        <button
          ref={pipsRef}
          type="button"
          className="inbox-strip-pips"
          onMouseEnter={() => {
            if (typeof window !== "undefined" && window.matchMedia &&
                window.matchMedia("(hover: none)").matches) return;
            setPreviewIdx(0);
          }}
          onMouseLeave={() => setPreviewIdx(null)}
          onFocus={() => {
            if (typeof window !== "undefined" && window.matchMedia &&
                window.matchMedia("(hover: none)").matches) return;
            if (visible.length > 0) setPreviewIdx(0);
          }}
          onBlur={() => setPreviewIdx(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPreviewIdx((p) => Math.min(visible.length - 1, (p ?? -1) + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setPreviewIdx((p) => Math.max(0, (p ?? visible.length) - 1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setPreviewIdx(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setPreviewIdx(visible.length - 1);
            } else if (e.key === "Escape") {
              setPreviewIdx(null);
              e.currentTarget.blur();
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const idx = previewIdx ?? 0;
              const it = visible[idx];
              if (it) onItemClick(it.id, it.pipelineId);
            }
          }}
          onClick={() => {
            if (previewItem) {
              onItemClick(previewItem.id, previewItem.pipelineId);
            } else if (isCoarsePointer()) {
              onExpand();
            } else if (visible.length > 0) {
              onItemClick(visible[0].id, visible[0].pipelineId);
            } else {
              onExpand();
            }
          }}
          title={
            previewItem
              ? "點擊跳該 pipeline · 滾輪 / 方向鍵切換"
              : "hover / focus 預覽 · 滾輪 / 方向鍵切換 · 點擊跳"
          }
          aria-label={pipsAriaLabel}
          aria-describedby={previewItem ? "inbox-strip-preview-live" : undefined}
        >
          {visible.map((it, i) => (
            <span
              key={it.id}
              className={
                "inbox-strip-pip" +
                (it.unread ? " is-unread" : "") +
                " is-" + it.sev +
                (i === previewIdx ? " is-preview" : "")
              }
              style={{ "--strip-color": SEV_COLOR[it.sev] }}
              aria-hidden="true"
            />
          ))}
          {overflow > 0 && (
            <span className="inbox-strip-overflow mono" aria-hidden="true">
              +{overflow}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          className="inbox-strip-pips-empty"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          title="展開通知"
          aria-label="展開通知"
        />
      )}

      <div className="inbox-strip-spacer"></div>
      <div className="inbox-strip-label" aria-hidden="true">通知</div>

      {previewItem && previewPos && createPortal(
        <div
          id="inbox-strip-preview-live"
          role="status"
          aria-live="polite"
          className="inbox-strip-preview"
          style={{
            "--preview-color": SEV_COLOR[previewItem.sev],
            top: previewPos.top,
            right: previewPos.right,
          }}
        >
          <div className="inbox-strip-preview-head">
            <span className={"inbox-strip-preview-dot is-" + previewItem.sev} />
            <span className="inbox-strip-preview-title">{previewItem.title}</span>
          </div>
          {previewItem.sub && (
            <div className="inbox-strip-preview-sub">{previewItem.sub}</div>
          )}
          <div className="inbox-strip-preview-meta mono">
            {previewItem.ts} · {previewIdx + 1}/{visible.length}
            {previewItem.unread ? " · 未讀" : ""}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function InboxPanel({
  items, filter, setFilter, unreadCount, highlightId, onCollapse,
  onMarkRead, onDismiss, onMarkAllRead, onDismissAll, onItemClick,
}) {
  const filtered = items.filter((it) => {
    if (filter === "unread") return !!it.unread;
    if (filter === "blocking") return it.sev === "block";
    return true;
  });

  const blockCount = items.filter((i) => i.sev === "block").length;
  const highlightItem = highlightId ? items.find((i) => i.id === highlightId) : null;

  return (
    <div className="inbox-panel">
      <div className="inbox-head">
        <h3>通知</h3>
        {unreadCount > 0 && <span className="inbox-head-count mono">{unreadCount} 未讀</span>}
        <div className="inbox-head-actions">
          <button
            type="button"
            className="icon-btn inbox-collapse-btn"
            title="收合通知"
            onClick={onCollapse}
            aria-label="收合通知欄"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <fieldset className="inbox-filter" aria-label="通知篩選">
        {[
          ["all", "全部", items.length],
          ["unread", "未讀", unreadCount],
          ["blocking", "阻斷", blockCount],
        ].map(([key, label, count]) => (
          <button type="button"
            key={key}
            className={"inbox-filter-btn" + (filter === key ? " is-active" : "")}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            aria-label={`${label}通知 篩選,${count} 則${filter === key ? ",目前選取" : ""}`}
          >
            {label}
            <span className="inbox-filter-count mono" aria-hidden="true">{count}</span>
          </button>
        ))}
      </fieldset>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {highlightItem ? `已開啟通知：「${highlightItem.title}」` : ""}
      </div>

      {filtered.length === 0 ? (
        <div className="inbox-list inbox-list-empty" role="status" aria-live="polite">
          <div className="inbox-empty">
            <div className="inbox-empty-icon">
              <InboxEmptyIcon />
            </div>
            <div>
              {items.length === 0
                ? "目前沒有通知"
                : filter === "unread"
                  ? "都看過了"
                  : filter === "blocking"
                    ? "沒有阻斷類通知"
                    : "目前沒有通知"}
            </div>
          </div>
        </div>
      ) : (
        <ul
          className="inbox-list"
          aria-label={`通知列表,共 ${filtered.length} 則${
            filter === "all" ? "" : `(已套用「${filter === "unread" ? "未讀" : "阻斷"}」篩選)`
          }`}
        >
          {filtered.map((it) => (
            <li key={it.id} className="inbox-list-item">
              <InboxItem
                item={it}
                highlight={highlightId === it.id}
                onMarkRead={onMarkRead}
                onDismiss={onDismiss}
                onClick={() => onItemClick(it.id, it.pipelineId)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="inbox-foot">
        <span>共 {items.length} 則通知{unreadCount > 0 ? ` · ${unreadCount} 未讀` : ""}</span>
        <span style={{ flex: 1 }} />
        {items.length > 0 && unreadCount > 0 && (
          <button type="button"
            className="inbox-foot-link"
            onClick={(e) => {
              e.preventDefault();
              onMarkAllRead();
            }}
            aria-label={`全部標為已讀(${unreadCount} 則)`}
          >
            全部標為已讀
          </button>
        )}
        {items.length > 0 && (
          <button type="button"
            className="inbox-foot-link inbox-foot-link-danger"
            title="清除所有通知"
            onClick={(e) => {
              e.preventDefault();
              onDismissAll();
            }}
            aria-label={`清除全部通知(${items.length} 則)`}
          >
            清除全部通知
          </button>
        )}
      </div>
    </div>
  );
}

function InboxItem({ item, highlight, onMarkRead, onDismiss, onClick }) {
  void onMarkRead;
  const c = SEV_COLOR[item.sev];
  const ariaLabel = (() => {
    const parts = [];
    parts.push(item.unread ? "未讀" : "已讀");
    parts.push(`${SEV_TEXT[item.sev] ?? ""}通知`);
    parts.push(`標題:「${item.title}」`);
    if (item.sub) parts.push(`說明:${item.sub}`);
    parts.push(`時間:${item.ts}`);
    return parts.join("。");
  })();
  return (
    <article
      className={"inbox-item is-" + item.sev + (item.unread ? " is-unread" : "") + (highlight ? " fade-up" : "")}
      style={{ "--item-color": c }}
    >
      <button
        type="button"
        className="inbox-item-open"
        onClick={onClick}
        aria-label={`開啟${ariaLabel}相關 pipeline`}
      />
      <button type="button"
        className="inbox-item-x"
        title="移除"
        aria-label={`移除通知「${item.title}」`}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(item.id);
        }}
      >
        <CloseIcon />
      </button>
      <div className="inbox-item-head">
        <span className={"inbox-item-dot" + (item.unread ? " is-unread" : " is-read")} aria-hidden="true" />
        <span className="inbox-item-title">{item.title}</span>
      </div>
      <div className="inbox-item-sub">{item.sub}</div>
      <div className="inbox-item-meta">
        <span className="inbox-item-ts mono">{item.ts}</span>
      </div>
      {(item.primary || item.secondary) && (
        <div className="inbox-item-actions">
          {item.secondary && (
            <button type="button"
              className="inbox-item-action"
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(item.id);
              }}
            >
              {item.secondary.label}
            </button>
          )}
          {item.primary && (
            <button type="button"
              className={
                "inbox-item-action" +
                (item.primary.kind === "block"
                  ? " is-primary"
                  : item.primary.kind === "info"
                  ? " is-primary-info"
                  : "")
              }
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
            >
              {item.primary.label}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// ─── fixtures(43 NotifEventType × 3 sev,涵蓋 read/unread/blocking + actions)

function mkItem(type, idx, override = {}) {
  const meta = NOTIF_EVENTS[type];
  const sev = override.sev ?? meta.sev;
  const base = {
    id: `${type}-${idx}`,
    type,
    sev,
    title: meta.label,
    sub: TYPE_SUB[type] ?? "",
    ts: TYPE_TS[idx % TYPE_TS.length],
    unread: true,
    pipelineId: `pl-${type.slice(0, 6)}-${idx}`,
  };
  return { ...base, ...override };
}

// 每個 type 一句 sub(模擬 NotifRecord.sub 內容)
const TYPE_SUB = {
  project_init: "已於 ~/projects/vibe-pipeline 完成初始化",
  pipeline_created: "feat-ui-refresh · 4 ticket",
  pipeline_deleted: "feat-experimental-rail 已從 pipelines/ 移除",
  pipeline_renamed: "old-name → feat-token-cleanup",
  ticket_added: "T-014 加到 feat-ui-refresh",
  ticket_removed: "T-009 已從 chore-tokens 移除",
  ticket_status_changed: "T-008 從 doing → review",
  pipeline_started: "feat-ui-refresh · runner 開始於 14:32",
  pipeline_queued: "排隊位置 2 / 4 · 等前一條釋出 worktree",
  pipeline_paused: "feat-ui-refresh 已暫停 · 12 分鐘前",
  ticket_started: "T-013 開始,iter mode,critic budget 6 輪",
  iter_critic_pass: "T-013 critic ✓ 1/3 sample passed,進 done",
  iter_critic_fail: "T-013 連續 3 輪 critic fail · 升為 block",
  ticket_done: "T-013 完成 · 7 min 21 s · $0.142",
  ticket_failed: "T-011 doer 拋 exception · stderr 已存 .runtime/last-stderr.log",
  pipeline_ready_to_merge: "feat-ui-refresh 4/4 done · 等 merge",
  merge_started: "AI 合併 feat-ui-refresh → main · attempt 1/3",
  merge_blocked: "feat-ui-refresh 三輪 AI 合併皆 conflict 失敗,需 user 介入",
  pipeline_auto_merge_started: "autoMerge=on · 條件達成,自動 merge 已排入",
  pipeline_merged: "feat-ui-refresh ✓ 合併 main · 47 commit",
  pipeline_merge_cleanup_failed: "Worktree pipeline/feat-ui-refresh 移除失敗 (EBUSY)",
  pipeline_failed: "feat-ui-refresh runner 已停 · 最後 ticket T-011 failed",
  budget_warn: "feat-ui-refresh 已用 $1.68 / $2.00 (84%)",
  budget_hard_cap: "feat-ui-refresh 觸及 $2.00 上限 · runner 已停",
  pipeline_blocked_budget: "本日總 budget $5 已耗盡 · 5 條 pipeline 入 queue",
  runner_stall: "feat-ui-refresh runner 連續 4 min 無 stdout · pid 18342",
  runner_crash: "feat-ui-refresh runner exit 137 · OOM kill",
  sync_started: "feat-ui-refresh 同步 base=main 啟動",
  sync_conflict: "src/styles/tokens.css 3 處衝突 · 等 user 選擇",
  sync_succeeded: "feat-ui-refresh fast-forward 至 base@a3f7b1",
  sync_failed: "merge 過程 git wedge,需手動清 .git/MERGE_HEAD",
  skill_candidate: "skills/iter-uiux 提案 staged · 待 review",
  cross_pipeline_pattern: "3 條 pipeline 都改了 src/ui/Toast.tsx · 建議萃 SKILL",
  scheduler_fired: "scheduler: daily-housekeeping 已執行 (07:00)",
  frontend_action_failed: "Delete pipeline → DELETE /api/pipelines/x 回 500",
  frontend_action_warn: "QA 寫入時 disk 已 92% 滿",
  frontend_action_info: "Theme 切換為 dark",
  system_updating: "自動更新 1.4.2 → 1.4.3 · 預計重啟 8s",
};

const TYPE_TS = ["剛剛", "1 分鐘前", "3 分鐘前", "12 分鐘前", "32 分鐘前", "1 小時前", "3 小時前", "今天 09:14", "今天 07:00", "昨天 22:31", "2 天前", "2026-05-23 14:32"];

// 8 種 scenario:從 source 邏輯反推 design 端需要看到的 inbox 狀態組合
const SCENARIOS = {
  "full-43": {
    label: "全 43 種 NotifEventType(混 sev,半數未讀)",
    build: () => {
      const types = Object.keys(NOTIF_EVENTS);
      return types.map((t, i) => mkItem(t, i, {
        unread: i % 2 === 0,
        primary: NOTIF_EVENTS[t].sev === "block" && i % 2 === 0
          ? { label: "處理", kind: "block" }
          : NOTIF_EVENTS[t].sev === "info" && i % 5 === 0
          ? { label: "查看", kind: "info" }
          : undefined,
        secondary: i % 3 === 0 ? { label: "已讀" } : undefined,
      }));
    },
  },
  "only-blocking": {
    label: "只剩 block(全未讀,全有 primary action)",
    build: () => {
      const blockTypes = Object.keys(NOTIF_EVENTS).filter((t) => NOTIF_EVENTS[t].sev === "block");
      return blockTypes.map((t, i) => mkItem(t, i, {
        unread: true,
        primary: { label: t === "sync_conflict" ? "選擇" : t === "merge_blocked" ? "處理" : t === "budget_hard_cap" ? "提額" : "處理", kind: "block" },
      }));
    },
  },
  "only-info": {
    label: "只 info(混 read/unread)",
    build: () => {
      const infoTypes = Object.keys(NOTIF_EVENTS).filter((t) => NOTIF_EVENTS[t].sev === "info");
      return infoTypes.map((t, i) => mkItem(t, i, {
        unread: i % 2 === 0,
        primary: i === 0 ? { label: "查看", kind: "info" } : undefined,
        secondary: i === 1 ? { label: "已讀" } : undefined,
      }));
    },
  },
  "only-muted": {
    label: "只 muted activity log(全已讀)",
    build: () => {
      const mutedTypes = Object.keys(NOTIF_EVENTS).filter((t) => NOTIF_EVENTS[t].sev === "muted");
      return mutedTypes.map((t, i) => mkItem(t, i, { unread: false }));
    },
  },
  "mixed-some-unread": {
    label: "9 則 mixed:1 block-unread / 2 info / 6 muted",
    build: () => [
      mkItem("ticket_failed", 0, { unread: true, primary: { label: "查看 stderr", kind: "block" }, secondary: { label: "已讀" } }),
      mkItem("ticket_done", 1, { unread: true, primary: { label: "看 diff", kind: "info" } }),
      mkItem("iter_critic_pass", 2, { unread: false }),
      mkItem("ticket_started", 3, { unread: false }),
      mkItem("pipeline_created", 4, { unread: false }),
      mkItem("ticket_status_changed", 5, { unread: false }),
      mkItem("ticket_added", 6, { unread: false }),
      mkItem("frontend_action_info", 7, { unread: false }),
      mkItem("project_init", 8, { unread: false }),
    ],
  },
  "empty": {
    label: "完全空 inbox",
    build: () => [],
  },
  "empty-unread-filter-active": {
    label: "有 items 但 filter=unread 時無命中(走「都看過了」)",
    build: () => [
      mkItem("ticket_done", 0, { unread: false }),
      mkItem("ticket_started", 1, { unread: false }),
      mkItem("pipeline_merged", 2, { unread: false }),
    ],
  },
  "long-titles": {
    label: "極長 title / sub(測 wrap / clamp)",
    build: () => [
      {
        id: "long-1", type: "merge_blocked", sev: "block", unread: true,
        title: "AI 合併 feat-very-long-pipeline-name-that-keeps-going-and-going-into-the-void-without-mercy 連續三輪皆衝突,等使用者人工處理",
        sub: "Conflict 集中在 src/features/very/deeply/nested/path/Component.tsx 的 importMap 區段;另外 src/styles/tokens.css 也有 3 處衝突,可能跟最近的 design token rename pull-request 撞到",
        ts: "1 小時前(2026-05-25 13:14 UTC)",
        pipelineId: "pl-long-1",
        primary: { label: "進入 SyncConflictModal 選擇處理方式", kind: "block" },
        secondary: { label: "稍後處理 / 標為已讀" },
      },
      mkItem("sync_conflict", 1, { unread: true, primary: { label: "選擇", kind: "block" } }),
      mkItem("ticket_done", 2, { unread: false }),
    ],
  },
};

// ─── DemoApp ─────────────────────────────────────────────────────────────

function DemoApp() {
  const [theme, setTheme] = useState("dark");
  const [density, setDensity] = useState("normal");
  const [state, setState] = useState("expanded");
  const [filter, setFilter] = useState("all");
  const [scenarioKey, setScenarioKey] = useState("full-43");
  const [highlightId, setHighlightId] = useState("");

  // 維持「dismiss / markRead」可視化:用本地 store 模擬 backend mutation
  const baseItems = useMemo(() => SCENARIOS[scenarioKey].build(), [scenarioKey]);
  const [localItems, setLocalItems] = useState(baseItems);
  useEffect(() => { setLocalItems(baseItems); }, [baseItems]);

  useEffect(() => {
    document.documentElement.className = theme === "light" ? "light" : "";
    document.documentElement.setAttribute("data-density", density);
  }, [theme, density]);

  const unreadCount = localItems.filter((i) => i.unread).length;

  const onMarkRead = (id) => {
    setLocalItems((items) => items.map((it) => it.id === id ? { ...it, unread: false } : it));
  };
  const onDismiss = (id) => {
    setLocalItems((items) => items.filter((it) => it.id !== id));
  };
  const onMarkAllRead = () => {
    setLocalItems((items) => items.map((it) => ({ ...it, unread: false })));
  };
  const onDismissAll = () => {
    setLocalItems([]);
  };
  const onItemClick = (id, pipelineId) => {
    console.log("[demo] item click", id, pipelineId);
    // 點 item 同時模擬 markRead(對齊 production InboxColumn 在 click 之後 focusNotif 流程)
    onMarkRead(id);
    setHighlightId(id);
  };

  // highlight options(下拉用)
  const highlightOptions = useMemo(() => [
    { value: "", label: "(none)" },
    ...localItems.map((it) => ({ value: it.id, label: `${it.id} · ${it.title.slice(0, 28)}…` })),
  ], [localItems]);

  // 同 source AppShell 結構:.notif-root > .board-body(grid)> nav / main / aside
  // notif.css 用 .notif-root.is-inbox-{state} 控 --inbox-w(320 / 52 / 0)
  const notifRootClass =
    "notif-root" +
    (state === "collapsed" ? " is-inbox-collapsed" : "") +
    (state === "hidden" ? " is-inbox-hidden" : "");

  return (
    <div className={"proto-shell " + notifRootClass}>
      <div className="proto-topbar">
        <span className="proto-topbar-brand mono">vibe-pipeline</span>
        <span className="proto-topbar-sep">/</span>
        <span className="proto-topbar-pipeline">feat-ui-refresh</span>
      </div>
      <div className="board-body">
        <nav>
          <aside className="proto-rail">
            <div className="proto-rail-title">PROJECT</div>
            <div className="proto-rail-item active">
              <span className="proto-rail-dot" style={{ background: "var(--accent)" }} />
              <span>vibe-pipeline</span>
            </div>
            <div className="proto-rail-title" style={{ marginTop: 18 }}>PIPELINES</div>
            <div className="proto-rail-item active">
              <span className="proto-rail-dot" style={{ background: "var(--running)" }} />
              <span>feat-ui-refresh</span>
            </div>
            <div className="proto-rail-item">
              <span className="proto-rail-dot" style={{ background: "var(--done)" }} />
              <span>hotfix-toast-z</span>
            </div>
            <div className="proto-rail-item">
              <span className="proto-rail-dot" style={{ background: "var(--draft)" }} />
              <span>chore-tokens</span>
            </div>
          </aside>
        </nav>
        <main>
          <div className="proto-main-placeholder">
            <h2>FocusColumn（mock 視覺脈絡）</h2>
            <p>右側為 <code>InboxColumn</code> 的 prototype。透過右下 demo panel 切換 state / filter / scenario。</p>
            <p style={{ marginTop: 18, fontSize: 12, color: "var(--fg-faint)" }}>
              .notif-root class 套用 <code>{notifRootClass}</code>,grid 第 3 欄寬 = <code>--inbox-w</code>
            </p>
          </div>
        </main>
        <aside>
          <InboxColumn
            items={localItems}
            filter={filter}
            setFilter={setFilter}
            unreadCount={unreadCount}
            highlightId={highlightId || null}
            state={state}
            setState={setState}
            onMarkRead={onMarkRead}
            onDismiss={onDismiss}
            onMarkAllRead={onMarkAllRead}
            onDismissAll={onDismissAll}
            onItemClick={onItemClick}
          />
        </aside>
      </div>

      <div className="proto-demo-panel">
        <h4>Theme</h4>
        <label><input type="radio" name="theme" checked={theme === "dark"} onChange={() => setTheme("dark")} /> dark</label>
        <label><input type="radio" name="theme" checked={theme === "light"} onChange={() => setTheme("light")} /> light</label>

        <h4>density(對齊 data-density attr;notif.css 本身未引用,留作 design 端擴充)</h4>
        <label><input type="radio" name="density" checked={density === "normal"} onChange={() => setDensity("normal")} /> normal</label>
        <label><input type="radio" name="density" checked={density === "compact"} onChange={() => setDensity("compact")} /> compact</label>

        <h4>InboxState(3)</h4>
        <label><input type="radio" name="state" checked={state === "expanded"} onChange={() => setState("expanded")} /> expanded</label>
        <label><input type="radio" name="state" checked={state === "collapsed"} onChange={() => setState("collapsed")} /> collapsed(strip)</label>
        <label><input type="radio" name="state" checked={state === "hidden"} onChange={() => setState("hidden")} /> hidden</label>

        <h4>InboxFilter(3)— 僅 expanded 生效</h4>
        <label><input type="radio" name="filter" checked={filter === "all"} onChange={() => setFilter("all")} /> all</label>
        <label><input type="radio" name="filter" checked={filter === "unread"} onChange={() => setFilter("unread")} /> unread</label>
        <label><input type="radio" name="filter" checked={filter === "blocking"} onChange={() => setFilter("blocking")} /> blocking</label>

        <h4>scenario(8)</h4>
        <select value={scenarioKey} onChange={(e) => setScenarioKey(e.target.value)}>
          {Object.entries(SCENARIOS).map(([k, v]) => (
            <option key={k} value={k}>{k} — {v.label}</option>
          ))}
        </select>

        <h4>highlightId(focusNotif 後的 fade-up flash)</h4>
        <select value={highlightId} onChange={(e) => setHighlightId(e.target.value)}>
          {highlightOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <h4>actions</h4>
        <label><button type="button" className="proto-mini-btn" onClick={() => setLocalItems(baseItems)}>reset scenario fixtures</button></label>
        <label><button type="button" className="proto-mini-btn" onClick={onMarkAllRead}>mark all read</button></label>
        <label><button type="button" className="proto-mini-btn" onClick={onDismissAll}>dismiss all</button></label>

        <hr />
        <div style={{ fontSize: 10.5, color: "var(--fg-faint)", lineHeight: 1.6 }}>
          unreadCount = <span className="mono">{unreadCount}</span>
          {" · "}items = <span className="mono">{localItems.length}</span>
          {" · "}filtered = <span className="mono">{
            localItems.filter((it) => filter === "all" ? true : filter === "unread" ? !!it.unread : it.sev === "block").length
          }</span>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<DemoApp />);

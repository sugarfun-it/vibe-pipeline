import { useEffect, useRef, useState } from "react";
import "../../styles/drawer.css";
import "./qa.css";
import type { Draft, TicketSpec } from "../../api/qa";
import { ArrowRightIcon } from "../../ui/icons";
import { Overlay } from "../../ui/Overlay";
import { InlineMultiSelect } from "./InlineMultiSelect";
import { FIELD_LABELS, SpecChecklist } from "./SpecChecklist";

const FIRST_AI_MESSAGE = "描述需求、完成標準與限制條件，我會整理成需求單規格。";
const FIRST_AI_OPTIONS = [
  "建立功能需求",
  "整理錯誤回報",
  "盤點可建立的需求單",
];
const BOOTSTRAP_LABEL = "啟動需求整理";

export function QADrawer({
  pipelineName,
  draft,
  busy,
  onSendTurn,
  onFinalize,
  onCancel,
  onClose,
}: {
  pipelineName: string;
  draft: Draft | null;
  busy: boolean;
  onSendTurn: (userMessage: string) => void;
  onFinalize: (edits?: Partial<TicketSpec>, splitInto?: TicketSpec[]) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const composerTextRef = useRef<string>("");
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = "qadr-title";

  // View override:user 顯式選擇要看哪個視圖,蓋過 draft.complete 自動切的邏輯。
  // - "chat" :user 在 SpecReview 點「繼續討論」,即使 draft.complete=true 也回 chat
  // - "review":user 在 chat 點「回最終預覽」,即使 draft.complete=false 也跳預覽(spec 仍須 5/5)
  // - null :跟 draft.complete 自動切
  // 切 draft(draftId 變)清掉
  const [viewOverride, setViewOverride] = useState<"chat" | "review" | null>(null);
  useEffect(() => {
    setViewOverride(null);
  }, [draft?.draftId]);

  const specComplete = isSpecComplete(draft?.spec ?? null);
  // 最終 review 視圖條件:spec 5/5 齊,且(override="review" 或 draft.complete=true 且未 override="chat")
  const showReview =
    specComplete &&
    (viewOverride === "review" || (draft?.complete === true && viewOverride !== "chat"));
  const hasAnyTurn = (draft?.turns.length ?? 0) > 0;

  // a11y:對話建立流程開場焦點應落在輸入區,而不是「關閉」按鈕。
  // Overlay initialFocus="root" 後立即把焦點推給 composer textarea(若 draft 已存在且非 review 視圖)。
  // 切草稿 / 切視圖會再觸發。restoreFocus 由 Overlay 卸載時負責還給 opener。
  useEffect(() => {
    if (!draft) return;
    if (showReview) return;
    const id = requestAnimationFrame(() => {
      composerInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [draft?.draftId, showReview]);
  // 空狀態:剛開 drawer 還沒任何對話 — 不顯示一排灰色 checklist,避免把首次體驗變成「驗證失敗」表
  const showChecklist = !!draft && (hasAnyTurn || specComplete);

  // turns 增加 / 切回 chat 視圖時自動 scroll 到底,但首次掛載一律 anchor 頂(welcome bubble 完整可見),
  // 避免 mid-bubble 卡在 body 頂端產生視覺切斷感。user 想看歷史末段自己捲;新 turn 之後跟著黏底
  // showReview=true 期間 transcriptRef 沒掛(SpecReview 渲染);切回 chat 後新 ref 掛上才 scroll
  const prevTurnsLenRef = useRef<number>(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: draftId 變(切草稿)reset
  useEffect(() => {
    prevTurnsLenRef.current = -1;
  }, [draft?.draftId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns.length / showReview 是觸發訊號
  useEffect(() => {
    if (showReview) return;
    const turnsLen = draft?.turns.length ?? 0;
    const prev = prevTurnsLenRef.current;
    prevTurnsLenRef.current = turnsLen;
    const id = requestAnimationFrame(() => {
      const el = transcriptRef.current;
      if (!el) return;
      // 首次掛載(prev===-1):一律 scroll 頂,welcome bubble 完整 + 後面對話展開狀讓 user 自己捲
      // 後續 turn 增加(prev≥0 且 turnsLen>prev):scroll 到底跟著新訊息(chat 慣例)
      if (prev === -1) {
        el.scrollTo({ top: 0 });
        return;
      }
      if (turnsLen > prev) el.scrollTo({ top: el.scrollHeight });
    });
    return () => cancelAnimationFrame(id);
  }, [draft?.turns.length, draft?.draftId, showReview]);

  // 未送出文字確認用 in-drawer 彈窗(不用 window.confirm,避免破壞抽屜視覺一致)
  const [pendingClose, setPendingClose] = useState(false);
  const pendingCancelBtnRef = useRef<HTMLButtonElement>(null);
  const requestClose = () => {
    if (composerTextRef.current.trim().length > 0) {
      setPendingClose(true);
      return;
    }
    onClose();
  };
  // pendingClose:把焦點推到「繼續編輯」(預設安全動作 = 留下);
  // 同時 ESC 在 pending 期間視為「繼續編輯」(避免 ESC 再次 requestClose 進無限迴圈)
  useEffect(() => {
    if (!pendingClose) return;
    const id = requestAnimationFrame(() => {
      pendingCancelBtnRef.current?.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPendingClose(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [pendingClose]);

  return (
    <Overlay
      role="dialog"
      onRequestClose={requestClose}
      labelledBy={titleId}
      portal={false}
      initialFocus="root"
      surfaceRef={drawerRef}
      stageClassName="qadr-stage"
      surfaceClassName="qadr-drawer"
    >
        <div className="drawer-head qadr-head">
          <div className="drawer-crumb qadr-crumb">
            <span className="qadr-crumb-text">
              <span className="mono qadr-crumb-project" title={pipelineName}>
                {pipelineName}
              </span>
              <span className="qadr-crumb-current">新需求單</span>
            </span>
            <button type="button"
              ref={closeBtnRef}
              className="drawer-close create-x"
              onClick={requestClose}
              title={hasAnyTurn ? "關閉並保留草稿（下次可接續）" : "關閉並取消空白草稿"}
              aria-label={hasAnyTurn ? "關閉並保留草稿" : "關閉並取消空白草稿"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="drawer-titlerow">
            <div className="drawer-title" id={titleId}>
              {draft?.spec?.title
                || (draft
                  ? hasAnyTurn
                    ? "收斂中…"
                    : "新需求單"
                  : "新需求單")}
            </div>
          </div>
          <div className="drawer-meta mono">
            <span>{draft ? `${draft.turns.length} 輪對話` : "啟動中…"}</span>
            {draft && (
              <>
                <span className="sep">·</span>
                <span
                  className="qadr-draft-status"
                  title={`draftId: ${draft.draftId}`}
                  aria-label={hasAnyTurn ? "草稿已自動保留,關閉後可接續" : "尚未對話,關閉會自動取消空白草稿"}
                >
                  {hasAnyTurn ? "草稿已自動保留" : "空白草稿"}
                </span>
              </>
            )}
          </div>
          {showChecklist && <SpecChecklist spec={draft?.spec ?? null} />}
        </div>

        {pendingClose && (
          <section
            className="qadr-close-confirm"
            role="group"
            aria-labelledby="qadr-close-confirm-msg"
          >
            <p
              id="qadr-close-confirm-msg"
              className="qadr-close-confirm-msg"
              role="status"
              aria-live="polite"
            >
              輸入框還有未送出的內容，要關閉嗎？（草稿仍會保留，下次可接續）
            </p>
            <div className="qadr-close-confirm-actions">
              <button
                ref={pendingCancelBtnRef}
                type="button"
                className="btn"
                onClick={() => setPendingClose(false)}
              >
                繼續編輯
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPendingClose(false);
                  onClose();
                }}
              >
                關閉並保留草稿
              </button>
            </div>
          </section>
        )}

        {showReview ? (
          <div className="drawer-body qadr-body qadr-spec-body">
            <SpecReview
              spec={draft!.spec as TicketSpec}
              splitInto={draft?.splitInto}
              busy={busy}
              onCancel={onCancel}
              onFinalize={onFinalize}
              onResumeChat={() => setViewOverride("chat")}
            />
          </div>
        ) : (
          <>
            {/* spec 5/5 齊但 user 在 chat(被 override 或 backend complete=false)→ 顯示「回最終預覽」橫條 */}
            {specComplete && !showReview && (
              <div className="qadr-spec-ready-bar">
                <span
                  className="qadr-spec-ready-bar-text"
                  role="status"
                  aria-live="polite"
                >
                  規格已備齊，可隨時送出建立需求單。
                </span>
                <button
                  type="button"
                  className="btn btn-primary qadr-spec-ready-bar-btn"
                  onClick={() => setViewOverride("review")}
                  disabled={busy}
                >
                  查看最終預覽
                  <ArrowRightIcon aria-hidden focusable="false" />
                </button>
              </div>
            )}
            <div
              className="drawer-body qadr-body"
              ref={transcriptRef}
              aria-busy={
                (!draft && busy) ||
                (draft &&
                  (busy || draft.turns[draft.turns.length - 1]?.role === "user"))
                  ? true
                  : undefined
              }
            >
              {!draft && busy && (
                <div className="qadr-bootstrap" role="status" aria-live="polite">
                  <ThinkingDots />
                  <span className="qadr-bootstrap-label">{BOOTSTRAP_LABEL}</span>
                  <span className="qadr-bootstrap-sub">
                    正在準備這次的需求對話，稍候即可開始描述。
                  </span>
                </div>
              )}
              {draft && (() => {
                const lastTurn = draft.turns[draft.turns.length - 1];
                // last 是 user → AI 還在跑(或 user 中途關 drawer 再回來,backend 仍 pending),
                // 顯思考中。useQA 會 poll 把 AI 回覆寫回 state.draft
                const waitingForAI = lastTurn?.role === "user";
                const showThinking = busy || waitingForAI;
                const emptyTurns = draft.turns.length === 0;
                const last = lastAiOptions(draft);
                const showInlineMulti =
                  !emptyTurns &&
                  !showThinking &&
                  last.mode === "multi" &&
                  last.options.length > 0;
                return (
                  <>
                    <Bubble kind="ai" message={FIRST_AI_MESSAGE} />
                    {emptyTurns && (
                      <div className="qadr-empty-starter">
                        <div className="qadr-starter-label" id="qadr-starter-label">
                          快速起點（可直接點選，或在下方輸入自訂內容）
                        </div>
                        <div
                          className="qadr-suggestions"
                          role="group"
                          aria-labelledby="qadr-starter-label"
                        >
                          {FIRST_AI_OPTIONS.map((o) => (
                            <button
                              type="button"
                              key={o}
                              className="vp-chip vp-chip--action qadr-suggestion"
                              onClick={() => onSendTurn(o)}
                              disabled={busy}
                            >
                              {o}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {draft.turns.map((t) => (
                      <Bubble key={t.ts + ":" + t.role} kind={t.role} message={t.message} />
                    ))}
                    {showInlineMulti && (
                      <InlineMultiSelect
                        options={last.options}
                        busy={busy}
                        onSendMulti={(picks) => onSendTurn(picks.join("、"))}
                      />
                    )}
                    {showThinking && (
                      <div
                        className="qadr-loading"
                        role="status"
                        aria-live="polite"
                        id="qadr-thinking-status"
                      >
                        <span>助理思考中</span>
                        <ThinkingDots />
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            {/* bootstrap 階段(尚未有 draft)整個 footer 都收掉:沒 draft 沒有合法 input,
                composer / cancel / hint 出現只會誤導 user 以為可輸入。等 startQA 回來才掛 footer。 */}
            {draft && (
              <div className="drawer-foot qadr-foot">
                {/* spec 進度提示:防 AI 嘴砲「可以建 ticket」但實際還沒齊讓 user 困惑 */}
                {draft.spec && (() => {
                  const missing = FIELD_LABELS.filter((f) => {
                    const v = draft.spec?.[f.key];
                    if (v == null || v === "") return true;
                    if (Array.isArray(v) && v.length === 0) return true;
                    if (f.key === "mode") return v !== "step" && v !== "iter";
                    return false;
                  });
                  if (missing.length === 0) return null;
                  const filled = FIELD_LABELS.length - missing.length;
                  const labels = missing.map((m) => m.label);
                  const srSentence = `規格已完成 ${filled} / ${FIELD_LABELS.length}，待補：${labels.join("、")}。`;
                  return (
                    <div
                      className="qadr-progress mono"
                      role="status"
                      aria-live="polite"
                      aria-label={srSentence}
                    >
                      <span aria-hidden="true">
                        規格 {filled}/{FIELD_LABELS.length} · 待補
                      </span>
                      {missing.map((m, i) => (
                        <span
                          key={m.key}
                          className="qadr-progress-missing"
                          aria-hidden="true"
                        >
                          {m.label}
                          {i < missing.length - 1 ? "" : ""}
                        </span>
                      ))}
                    </div>
                  );
                })()}
                {(() => {
                  const last = lastAiOptions(draft);
                  const isFirstTurn = draft.turns.length === 0;
                  // multi 模式 options 改 render 成 inline reply block(InlineMultiSelect)在對話脈絡內,
                  // composer 只保留輸入列。mobile 不會再被 sticky footer 整組選項吃掉視野。
                  // single 模式 options 維持塞在 footer(短 list 排在輸入上方;首輪也走 inline starter)。
                  const composerOptions =
                    isFirstTurn || last.mode === "multi" ? [] : last.options;
                  // chat_thinking:last turn 是 user → AI 還在跑,把 textarea / send / options 一併鎖,
                  // 避免 user 再連送一輪(對 backend 也沒意義,turnQA 還沒回來)
                  const lastTurn = draft.turns[draft.turns.length - 1];
                  const waitingForAI = lastTurn?.role === "user";
                  const composerBusy = busy || waitingForAI;
                  return (
                    <Composer
                      options={composerOptions}
                      optionsMode={last.mode}
                      busy={composerBusy}
                      onSend={(msg) => {
                        onSendTurn(msg);
                      }}
                      onCancel={onCancel}
                      onTextChange={(v) => {
                        composerTextRef.current = v;
                      }}
                      inputRef={composerInputRef}
                    />
                  );
                })()}
              </div>
            )}
          </>
        )}
    </Overlay>
  );
}

function isSpecComplete(s: Partial<TicketSpec> | null): boolean {
  if (!s) return false;
  return (
    !!s.title &&
    !!s.goal &&
    Array.isArray(s.acceptance) &&
    s.acceptance.length > 0 &&
    !!s.prompt &&
    (s.mode === "step" || s.mode === "iter")
  );
}

function lastAiOptions(
  draft: Draft | null
): { options: string[]; mode: "single" | "multi" } {
  if (!draft) return { options: [], mode: "single" };
  if (draft.turns.length === 0) return { options: FIRST_AI_OPTIONS, mode: "single" };
  const last = draft.turns[draft.turns.length - 1];
  if (last.role !== "ai") return { options: [], mode: "single" };
  return { options: last.options ?? [], mode: last.optionsMode ?? "single" };
}

function ThinkingDots() {
  // 外層 "AI 思考中" 容器自己有 role=status,這裡的點點純裝飾,避免雙重宣告
  return (
    <span className="qadr-thinking-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function Bubble({ kind, message }: { kind: "user" | "ai"; message: string }) {
  return (
    <div className={"qadr-bubble qadr-bubble-" + kind}>
      <div className="qadr-bubble-role mono">{kind === "user" ? "你" : "助理"}</div>
      <div className="qadr-bubble-msg">{message}</div>
    </div>
  );
}

function Composer({
  options,
  optionsMode = "single",
  busy,
  onSend,
  onCancel,
  onTextChange,
  inputRef,
}: {
  options: string[];
  optionsMode?: "single" | "multi";
  busy: boolean;
  onSend: (msg: string) => void;
  onCancel: () => void;
  onTextChange?: (text: string) => void;
  inputRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const setTaRef = (el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    if (inputRef) inputRef.current = el;
  };
  const taId = "qadr-composer-textarea";

  function send(value: string) {
    const v = value.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
    onTextChange?.("");
    // 送出後重置 textarea 高度(setText 後 onChange 不會 fire,要手動)
    if (taRef.current) taRef.current.style.height = "auto";
  }

  // multi 模式 options 已由 InlineMultiSelect 在 body 內 inline 渲染,不再走 Composer。
  // Composer 只負責 single quickreply chips + textarea + send + cancel-link。
  return (
    <div className="qadr-composer">
      {options.length > 0 && optionsMode === "single" && (
        <div className="qadr-options">
          {options.map((o) => (
            <button type="button"
              key={o}
              className="btn qadr-option"
              onClick={() => send(o)}
              disabled={busy}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="qadr-composer-row">
        <label
          htmlFor={taId}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          描述要建立的需求單內容
        </label>
        <textarea
          ref={setTaRef}
          id={taId}
          className="qadr-input qadr-input-multiline"
          value={text}
          placeholder={busy ? "助理回覆後即可繼續補充…" : "描述要建立的需求單內容…"}
          rows={1}
          aria-label="描述要建立的需求單內容"
          aria-describedby={busy ? "qadr-thinking-status" : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onTextChange?.(e.target.value);
            // auto-grow:resize 到內容高度,max 8 行(超過 scroll)
            const ta = e.target;
            ta.style.height = "auto";
            const max = parseFloat(getComputedStyle(ta).lineHeight) * 8;
            ta.style.height = Math.min(ta.scrollHeight, max) + "px";
          }}
          onKeyDown={(e) => {
            // Enter 送出,Shift+Enter 換行
            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              send(text);
            }
          }}
          disabled={busy}
        />
        <button type="button"
          className="qadr-send"
          onClick={() => send(text)}
          disabled={busy || !text.trim()}
          aria-disabled={busy || !text.trim() ? "true" : undefined}
          title={!text.trim() ? "輸入內容後可送出（Enter）" : "送出（Enter）"}
          aria-label="送出訊息"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="qadr-composer-footer">
        <button
          className="qadr-cancel-link"
          onClick={onCancel}
          disabled={busy}
          type="button"
          title="放棄當前草稿，本次對話不會保留"
        >
          捨棄草稿
        </button>
        <div className="qadr-composer-hint mono" aria-hidden="true">
          Enter 送出 · Shift+Enter 換行
        </div>
      </div>
    </div>
  );
}

function SpecReview({
  spec,
  splitInto,
  busy,
  onCancel,
  onFinalize,
  onResumeChat,
}: {
  spec: TicketSpec;
  splitInto?: TicketSpec[];
  busy: boolean;
  onCancel: () => void;
  onFinalize: (edits?: Partial<TicketSpec>, splitInto?: TicketSpec[]) => void;
  // user 想退回 chat 跟 AI 再聊聊(改主意 / 補細節)。frontend 端 force 切視圖,
  // 不送 backend(下個 turn 自然會更新 spec/complete)
  onResumeChat?: () => void;
}) {
  const [edited, setEdited] = useState<TicketSpec>(spec);
  // 預設「不拆」:拆分=高影響動作(直接變 N 張需求單),不該偷偷預設選上;
  // user 看完 AI 拆分提案、確認想拆才主動勾。否則一鍵送出可能不知不覺多 N 張 ticket。
  const hasSplit = Array.isArray(splitInto) && splitInto.length >= 2;
  const [useSplit, setUseSplit] = useState<boolean>(false);

  return (
    <div className="qadr-spec">
      <div className="qadr-spec-head">最終預覽 — 微調後送出建立需求單。</div>
      {hasSplit && (
        <section
          className="qadr-split-proposal"
          aria-labelledby="qadr-split-title"
        >
          <header className="qadr-split-header">
            <h3 id="qadr-split-title" className="qadr-split-title">
              助理評估這張需求單範圍橫跨 {splitInto!.length} 件獨立工作
            </h3>
            <p className="qadr-split-subtitle">
              若拆分送出，會建立 {splitInto!.length} 張獨立需求單分別執行；
              若不拆分，以下方單張 spec 為準。
            </p>
          </header>
          <ol className="qadr-split-list">
            {splitInto!.map((s, i) => (
              <li key={i} className="qadr-split-item">
                <span className="qadr-split-num mono">#{i + 1}</span>
                <span className="qadr-split-item-title">{s.title}</span>
                <span className={"chip ticket-mode qadr-split-mode-chip" + (s.mode === "iter" ? " is-iter" : "")}>
                  {s.mode === "iter" ? "迭代" : "單次"}
                </span>
              </li>
            ))}
          </ol>
          <div className="qadr-split-toggle">
            <label className="qadr-split-toggle-label">
              <input
                type="checkbox"
                checked={useSplit}
                onChange={(e) => setUseSplit(e.target.checked)}
                aria-describedby="qadr-split-outcome"
              />
              <span>
                <strong>送出時拆成 {splitInto!.length} 張獨立需求單</strong>
                <span className="qadr-split-toggle-hint">
                  （取消勾選 = 合 1 張下方 spec）
                </span>
              </span>
            </label>
            <div
              id="qadr-split-outcome"
              className="qadr-split-outcome"
              role="status"
              aria-live="polite"
            >
              {useSplit
                ? `目前送出會建立 ${splitInto!.length} 張獨立需求單。`
                : "目前送出會建立 1 張合併需求單（以下方 spec 為準）。"}
            </div>
          </div>
        </section>
      )}
      <Field label="標題">
        <input
          className="qadr-input"
          value={edited.title}
          onChange={(e) => setEdited({ ...edited, title: e.target.value })}
        />
      </Field>
      <Field label="目標">
        <textarea
          className="qadr-input qadr-textarea"
          rows={3}
          value={edited.goal}
          onChange={(e) => setEdited({ ...edited, goal: e.target.value })}
        />
      </Field>
      <Field label="驗收">
        <textarea
          className="qadr-input qadr-textarea"
          rows={Math.max(4, edited.acceptance.length + 1)}
          value={edited.acceptance.join("\n")}
          onChange={(e) =>
            setEdited({ ...edited, acceptance: e.target.value.split("\n").filter(Boolean) })
          }
        />
      </Field>
      <Field label="提示詞">
        <textarea
          className="qadr-input qadr-textarea"
          rows={10}
          value={edited.prompt}
          onChange={(e) => setEdited({ ...edited, prompt: e.target.value })}
        />
      </Field>
      <Field label="模式" htmlId="qadr-mode-group">
        <div
          className="qadr-choice-row"
          role="radiogroup"
          aria-labelledby="qadr-mode-group-label"
        >
          <label className="qadr-radio-label">
            <input
              type="radio"
              name="qadr-mode"
              checked={edited.mode === "iter"}
              onChange={() => setEdited({ ...edited, mode: "iter" })}
            />
            迭代任務 (iter)
          </label>
          <label className="qadr-radio-label">
            <input
              type="radio"
              name="qadr-mode"
              checked={edited.mode === "step"}
              onChange={() => setEdited({ ...edited, mode: "step" })}
            />
            單次任務 (step)
          </label>
        </div>
      </Field>
      {edited.mode === "iter" && (
        <>
          <Field label="迭代上限輪數">
            <input
              className="qadr-input qadr-iter-limit-input"
              type="number"
              min={1}
              max={5}
              value={edited.iterLimit ?? 5}
              onChange={(e) => {
                const v = Math.max(1, Math.min(5, Number(e.target.value) || 5));
                setEdited({ ...edited, iterLimit: v });
              }}
            />
          </Field>
          <Field label="達上限後" htmlId="qadr-stoplimit-group">
            <div
              className="qadr-choice-row"
              role="radiogroup"
              aria-labelledby="qadr-stoplimit-group-label"
            >
              <label className="qadr-radio-label">
                <input
                  type="radio"
                  name="qadr-iter-stop"
                  checked={(edited.iterStopAtLimit ?? true) === true}
                  onChange={() => setEdited({ ...edited, iterStopAtLimit: true })}
                />
                整條 pipeline 暫停 (建議)
              </label>
              <label className="qadr-radio-label">
                <input
                  type="radio"
                  name="qadr-iter-stop"
                  checked={(edited.iterStopAtLimit ?? true) === false}
                  onChange={() => setEdited({ ...edited, iterStopAtLimit: false })}
                />
                標記為失敗，跳下一張
              </label>
            </div>
          </Field>
        </>
      )}
      <div className="qadr-spec-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          捨棄草稿
        </button>
        {onResumeChat && (
          <button
            type="button"
            className="btn"
            onClick={onResumeChat}
            disabled={busy}
            title="退回對話跟 AI 補充 / 修正細節,送出新訊息後 AI 會再整理 spec"
          >
            <ArrowRightIcon aria-hidden style={{ transform: "scaleX(-1)" }} /> 繼續討論
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => onFinalize(edited, useSplit ? splitInto : undefined)} disabled={busy}>
          {busy ? (
            <>
              <span className="qadr-thinking-dots">
                <span /><span /><span />
              </span>{" "}
              送出中…
            </>
          ) : useSplit && hasSplit ? (
            `送出建立 ${splitInto!.length} 張需求單`
          ) : hasSplit ? (
            "送出建立 1 張合併需求單"
          ) : (
            "送出建立需求單"
          )}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlId,
  children,
}: {
  label: string;
  htmlId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="qadr-field">
      <div
        className="qadr-field-label"
        id={htmlId ? `${htmlId}-label` : undefined}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

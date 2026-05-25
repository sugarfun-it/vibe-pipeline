import { useState } from "react";
import type { TicketSpec } from "../../api/qa";
import { ArrowRightIcon } from "../../ui/icons";

export function SpecReview({
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

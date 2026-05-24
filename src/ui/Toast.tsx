import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import "./toast.css";

export type ToastVariant = "info" | "success" | "warning" | "danger";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
};

export type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  action?: ToastAction;
  exiting?: boolean;
};

type ToastContextValue = {
  toast: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
};

const DEFAULT_DURATION = 3500;
const DANGER_DURATION = 12000;
const WARNING_DURATION = 7000;
const MAX_VISIBLE = 3;
const EXIT_MS = 180;

function defaultDurationFor(variant: ToastVariant): number {
  if (variant === "danger") return DANGER_DURATION;
  if (variant === "warning") return WARNING_DURATION;
  return DEFAULT_DURATION;
}

const Ctx = createContext<ToastContextValue | null>(null);

let __toastIdSeq = 0;
function nextId(): string {
  __toastIdSeq += 1;
  return "t" + Date.now().toString(36) + "_" + __toastIdSeq.toString(36);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const remainingRef = useRef<Map<string, { remaining: number; startedAt: number }>>(new Map());
  // Track hover and focus pause reasons separately so leaving with mouse
  // doesn't resume the timer while keyboard focus is still inside (codex
  // toast-success-008).
  const hoverPausedRef = useRef(false);
  const focusPausedRef = useRef(false);
  const isPaused = () => hoverPausedRef.current || focusPausedRef.current;

  const removeNow = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const ex = exitTimersRef.current.get(id);
    if (ex) {
      clearTimeout(ex);
      exitTimersRef.current.delete(id);
    }
    const tm = timersRef.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timersRef.current.delete(id);
    }
    remainingRef.current.delete(id);
  }, []);

  const dismiss = useCallback((id: string) => {
    const tm = timersRef.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timersRef.current.delete(id);
    }
    remainingRef.current.delete(id);
    if (exitTimersRef.current.has(id)) return;
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    const ex = setTimeout(() => removeNow(id), EXIT_MS);
    exitTimersRef.current.set(id, ex);
  }, [removeNow]);

  const armTimer = useCallback((id: string, ms: number) => {
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);
    if (ms <= 0) return;
    remainingRef.current.set(id, { remaining: ms, startedAt: Date.now() });
    if (isPaused()) return;
    const tm = setTimeout(() => dismiss(id), ms);
    timersRef.current.set(id, tm);
  }, [dismiss]);

  const toast = useCallback((message: string, options?: ToastOptions) => {
    const id = nextId();
    const variant: ToastVariant = options?.variant ?? "info";
    const item: ToastItem = {
      id,
      message,
      variant,
      duration: options?.duration ?? defaultDurationFor(variant),
      action: options?.action,
    };
    setItems((prev) => {
      const next = [...prev, item];
      // Animate excess oldest items out instead of cutting them (toast-stack-003).
      // If multiple toasts pile up faster than MAX_VISIBLE in one tick, dismiss
      // all of the overflow at once so the visible stack height stays close to
      // MAX_VISIBLE even under burst enqueue (toast-stack-009).
      const liveCount = next.filter((t) => !t.exiting).length;
      const overflow = liveCount - MAX_VISIBLE;
      if (overflow > 0) {
        const toDismiss: string[] = [];
        for (const t of next) {
          if (t.exiting || t.id === id) continue;
          toDismiss.push(t.id);
          if (toDismiss.length >= overflow) break;
        }
        if (toDismiss.length > 0) {
          queueMicrotask(() => toDismiss.forEach(dismiss));
        }
      }
      return next;
    });
    armTimer(id, item.duration);
    return id;
  }, [dismiss, armTimer]);

  // Pause-on-hover/focus across the whole stage so users have time to read,
  // copy, or click the action — covers codex toast-success-004 / danger-001.
  // Hover and focus reasons tracked separately; resume only fires when neither
  // is active (toast-success-008).
  const freezeTimers = useCallback(() => {
    const now = Date.now();
    timersRef.current.forEach((tm, id) => {
      clearTimeout(tm);
      const rec = remainingRef.current.get(id);
      if (rec) {
        const left = Math.max(0, rec.remaining - (now - rec.startedAt));
        remainingRef.current.set(id, { remaining: left, startedAt: now });
      }
    });
    timersRef.current.clear();
  }, []);
  const thawTimers = useCallback(() => {
    if (isPaused()) return;
    const now = Date.now();
    remainingRef.current.forEach((rec, id) => {
      if (timersRef.current.has(id)) return;
      if (rec.remaining <= 0) {
        // Toast's timer already elapsed while paused; dismiss now instead of
        // letting it linger indefinitely (codex toast-danger-012 deep edge).
        queueMicrotask(() => dismiss(id));
        return;
      }
      const tm = setTimeout(() => dismiss(id), rec.remaining);
      timersRef.current.set(id, tm);
      remainingRef.current.set(id, { remaining: rec.remaining, startedAt: now });
    });
  }, [dismiss]);
  const pauseForHover = useCallback(() => {
    if (hoverPausedRef.current) return;
    hoverPausedRef.current = true;
    freezeTimers();
  }, [freezeTimers]);
  const resumeFromHover = useCallback(() => {
    if (!hoverPausedRef.current) return;
    hoverPausedRef.current = false;
    thawTimers();
  }, [thawTimers]);
  const pauseForFocus = useCallback(() => {
    if (focusPausedRef.current) return;
    focusPausedRef.current = true;
    freezeTimers();
  }, [freezeTimers]);
  const resumeFromFocus = useCallback(() => {
    if (!focusPausedRef.current) return;
    focusPausedRef.current = false;
    thawTimers();
  }, [thawTimers]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      exitTimersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
      exitTimersRef.current.clear();
      remainingRef.current.clear();
    };
  }, []);

  // Reset pause flags when the visible queue empties — otherwise dismissing the
  // last toast while hovered/focused leaves the refs stuck true, and the next
  // enqueued toast would arm into remainingRef but never start timer
  // (toast-success-009 / toast-danger-012).
  useEffect(() => {
    if (items.length === 0) {
      hoverPausedRef.current = false;
      focusPausedRef.current = false;
    }
  }, [items.length]);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastStageInternal
        items={items}
        onDismiss={dismiss}
        onHoverPause={pauseForHover}
        onHoverResume={resumeFromHover}
        onFocusPause={pauseForFocus}
        onFocusResume={resumeFromFocus}
      />
    </Ctx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast 要在 ToastProvider 內用");
  return ctx;
}

type StageProps = {
  items: ToastItem[];
  onDismiss: (id: string) => void;
  onHoverPause: () => void;
  onHoverResume: () => void;
  onFocusPause: () => void;
  onFocusResume: () => void;
};

function ToastStageInternal({
  items,
  onDismiss,
  onHoverPause,
  onHoverResume,
  onFocusPause,
  onFocusResume,
}: StageProps) {
  // Keep exiting items rendered so the 180ms fade-out plays — even when over
  // MAX_VISIBLE (codex toast-stack-003). To honor the MAX_VISIBLE contract
  // strictly (codex toast-stack-011), prefer LIVE items: live fills first up
  // to MAX_VISIBLE, then remaining slots (if any) get the most-recent exiting
  // items. Total rendered never exceeds MAX_VISIBLE. The single overflow case
  // — exactly one toast pushed beyond cap — still gets its animated exit
  // because the oldest LIVE drops first and the new arrival takes its slot.
  const live = items.filter((t) => !t.exiting);
  const liveSlice = live.slice(-MAX_VISIBLE);
  const remainingSlots = Math.max(0, MAX_VISIBLE - liveSlice.length);
  const exiting = items.filter((t) => t.exiting).slice(-remainingSlots);
  const visible = [...exiting, ...liveSlice]
    .sort((a, b) => items.indexOf(a) - items.indexOf(b));
  if (visible.length === 0) return null;
  return (
    <div
      className="toast-stage"
      aria-hidden={false}
      onMouseEnter={onHoverPause}
      onMouseLeave={onHoverResume}
      onFocusCapture={onFocusPause}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusResume();
      }}
    >
      {visible.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const assertive = item.variant === "warning" || item.variant === "danger";
  const role = assertive ? "alert" : "status";
  const live = assertive ? "assertive" : "polite";
  return (
    <div
      className={"toast toast-" + item.variant + (item.exiting ? " toast-exit" : "")}
      role={role}
      aria-live={live}
      aria-atomic="true"
    >
      <div className="toast-message">{item.message}</div>
      <div className="toast-actions">
        {item.action && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              try { item.action!.onClick(); } finally { onDismiss(item.id); }
            }}
          >
            {item.action.label}
          </button>
        )}
        <button
          type="button"
          className="toast-close"
          aria-label="關閉通知"
          onClick={() => onDismiss(item.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// 給外部「手動 render stage」的需求(若 ToastProvider 之外想另外擺位置可單獨用)。
// 預設 ToastProvider 已內含 stage,正常情況不需要再 render 這個。
export function ToastStage() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ToastStage 要在 ToastProvider 內用");
  return null;
}

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
const MAX_VISIBLE = 3;
const EXIT_MS = 180;

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
  }, []);

  const dismiss = useCallback((id: string) => {
    const tm = timersRef.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timersRef.current.delete(id);
    }
    if (exitTimersRef.current.has(id)) return;
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    const ex = setTimeout(() => removeNow(id), EXIT_MS);
    exitTimersRef.current.set(id, ex);
  }, [removeNow]);

  const toast = useCallback((message: string, options?: ToastOptions) => {
    const id = nextId();
    const item: ToastItem = {
      id,
      message,
      variant: options?.variant ?? "info",
      duration: options?.duration ?? DEFAULT_DURATION,
      action: options?.action,
    };
    setItems((prev) => [...prev, item]);
    if (item.duration > 0) {
      const tm = setTimeout(() => dismiss(id), item.duration);
      timersRef.current.set(id, tm);
    }
    return id;
  }, [dismiss]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      exitTimersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
      exitTimersRef.current.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastStageInternal items={items} onDismiss={dismiss} />
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
};

function ToastStageInternal({ items, onDismiss }: StageProps) {
  const visible = items.slice(-MAX_VISIBLE);
  if (visible.length === 0) return null;
  return (
    <div className="toast-stage" aria-hidden={false}>
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

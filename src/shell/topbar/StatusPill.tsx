import { PlayIcon } from "../../ui/icons";

// N/M chip:過載(N>M,max_parallel 改小但已起的不 kill)時加括號標記
export function ParallelChip({ running, max }: { running: number; max: number }) {
  const overload = running > max;
  const color = overload
    ? "var(--failed)"
    : running >= max && running > 0
    ? "var(--queued)"
    : running > 0
    ? "var(--running)"
    : "var(--fg-mute)";
  return (
    <span
      className="chip mono parallel-chip"
      title={
        overload
          ? `正在執行 ${running} 條，已超過上限 ${max}（改小不會中止既有的）`
          : `同時執行 ${running} / ${max} 條`
      }
      aria-label={
        overload
          ? `正在執行 ${running} 條，已超過上限 ${max}`
          : `同時執行 ${running} / ${max} 條`
      }
      style={{ color }}
    >
      <span className="topbar-branch-icon"><PlayIcon /></span>
      {running}/{max}
      {overload && (
        // visual:用 emoji-style 不依賴(無 emoji),改成色塊 + 文字「超載」
        // 比舊版 `!` 更明確,a11y 改善:不只靠 color(advisor 2026-05-24)
        <span className="parallel-chip-overload" aria-hidden>超載</span>
      )}
    </span>
  );
}

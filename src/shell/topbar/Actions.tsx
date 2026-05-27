import type { ReactNode } from "react";
import { MoonIcon, SunIcon } from "../../ui/icons";
import { ParallelChip } from "./StatusPill";

type ActionsProps = {
  hash: string | null;
  isDark: boolean;
  maxParallel: number;
  runningCount: number;
  settingsSlot?: ReactNode;
  toggleTheme: () => void;
};

export function Actions({ hash, isDark, maxParallel, runningCount, settingsSlot, toggleTheme }: ActionsProps) {
  return (
      <div className="topbar-right">
        {hash && maxParallel > 0 && (
          <ParallelChip running={runningCount} max={maxParallel} />
        )}
        <button type="button"
          className="icon-btn topbar-theme-toggle"
          onClick={toggleTheme}
          title={isDark ? "切到亮色" : "切到暗色"}
          aria-label={isDark ? "切到亮色主題" : "切到暗色主題"}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
        {settingsSlot}
      </div>
  );
}

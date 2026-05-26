import { memo, useRef, useState } from "react";
import { GearIcon } from "../../../ui/icons";
import { SettingsPopover } from "../../settings/SettingsPopover";
import type * as api from "../../../api";

// Gear button + Settings popover。原本在 shell/TopBar 內,因為 SettingsPopover 屬 features/
// 不該被 shell 認識,改由 BoardScreen 注入 TopBar 的 settingsSlot。
export const SettingsButton = memo(function SettingsButton({
  hash,
  onConfigSaved,
}: {
  hash: string | null;
  onConfigSaved?: (cfg: api.ProjectConfig) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={btnRef}
        type="button"
        className={"icon-btn" + (open ? " is-active" : "")}
        title={hash ? "設定" : "選擇 project 後可開設定"}
        onClick={() => hash && setOpen((o) => !o)}
        disabled={!hash}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <GearIcon />
      </button>
      {hash && (
        <SettingsPopover
          hash={hash}
          open={open}
          onClose={() => setOpen(false)}
          onSaved={(cfg) => {
            onConfigSaved?.(cfg);
          }}
          anchorRef={btnRef}
        />
      )}
    </span>
  );
});

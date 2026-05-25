# Comment System Design

_Started 2026-05-25 07:30 UTC_

---

## User

Apply comment

## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: show_html]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: sleep]_

_[tool: write_file]_

_[tool: show_html]_

_[tool: sleep]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: write_file]_

_[tool: str_replace_edit]_

_[tool: show_html]_

_[tool: sleep]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: str_replace_edit]_

Now I understand the bug. At < 540px the meta row reverts to `flex-wrap: nowrap` with `overflow-x: auto`, but `.focus-actions` (which is a child of the meta row!) has `flex: 0 0 100%` from the < 720px rule — so it tries to be 100% wide *inside the nowrap row*, overflowing off-screen. At the same time, all the chips collapse to ~16px because of `min-width: 0 + text-overflow: ellipsis`, hiding the diff/sync info.

Let me fix the mobile layout properly:

_[tool: eval_js]_

_[tool: sleep]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: delete_file]_

All presets now fit within the 390px viewport — no horizontal overflow, actions stay inside the body padding. Let me clean up the test scaffolding and surface the fix.

_[tool: done]_

手機版破版修好了。

**問題根因**：在 `< 540px` 的 breakpoint 裡，`focus-head-meta-row` 被改成 `flex-wrap: nowrap; overflow-x: auto`，但 `focus-actions` 是這個 row 的子元素，且從 `< 720px` 繼承到 `flex: 0 0 100%`——它在不換行的 row 裡硬塞 100% 寬度，整個按鈕群就被推到畫面外（x=143, 寬 362, 在 390px viewport 裡爆出右邊 115px）。同時 chips 因為 `min-width: 0 + text-overflow: ellipsis` 被壓縮成 16px 寬，只剩 `·` 符號，diff/sync 資訊全部消失。

**修正**：
- `< 720px` 和 `< 540px` meta row 統一改成 `flex-wrap: wrap`，不再切換成 nowrap+水平卷軸
- chips 移除 `min-width: 0 / overflow / ellipsis`，內容完整顯示並換行
- actions 在 mobile 強制 `width: 100%`、`order: 99`、自己一行帶虛線分隔，按鈕在窄寬時也可以 wrap
- title row 的 ⋯ overflow menu 用 `margin-left: auto` 釘在右邊（不再用 absolute positioning）
- 在 `< 540px` 把主要按鈕 `min-height` 拉到 32–34px 確保 mobile 觸控目標

10 個 preset 場景在 390px 寬度下都已驗證無水平 overflow。


# CSS 放置規則

決定一個 `.css` 該擺 `src/styles/` 還是 colocate 在 `src/features/<name>/` 的判準。SSOT,改 CSS 結構前對齊。

## 規則

### 放 `src/styles/<name>.css`(global / shared)

- 跨 **2 個以上 feature** 共用,或屬於 **app-wide design token / shell layout**
- 檔名直接用語意名(無 prefix),例 `tokens.css`、`board.css`、`drawer.css`

### Colocate 在 `src/features/<feature>/<filename>.css`

- 只有單一 feature(該 dir 下的 component)在用
- 檔名 prefix 對應 component 名(camelCase 配合 component 檔名),例 `diffModal.css` 配 `DiffModal.tsx`、`auditTimeline.css` 配 `AuditTimeline.tsx`
- 由對應 component `.tsx` 直接 `import "./<filename>.css"`,不要從別的 feature 反向 import

## 範例

| 檔案 | 為何在那 |
|---|---|
| `src/styles/tokens.css` | 全站 design token,所有 feature 共用 → global |
| `src/styles/drawer.css` | overlay/drawer 基礎樣式被多個 feature(qa、pipeline、settings ...)的 drawer / popover 共用 → global |
| `src/styles/board.css` | BoardScreen 與相關 layout 屬於 app shell 層 → global |
| `src/features/pipeline/diffModal.css` | 只給 `DiffModal.tsx` 用 → colocate |
| `src/features/pipeline/auditTimeline.css` | 只給 `AuditTimeline.tsx` 用 → colocate |
| `src/features/qa/qa.css` | QA feature 內部專用 → colocate |
| `src/features/settings/SettingsPopover.css` | 只給 SettingsPopover 用(歷史用 PascalCase,新檔請改 camelCase prefix) → colocate |

## 避雷

- **禁止同名並存** — 不能同時有 `src/styles/X.css` 與 `src/features/X/X.css`。撞名導致 grep import / 翻 dir 都會混淆。新增前先 grep 確認沒撞。當 feature dir 名稱與 global 用途撞時,global 那邊用更明確的名字(例 `<feature>-screen.css`)。
- **新檔 prefix 用 camelCase 配 component**(`toast.css`、`confirmDialog.css` 模式),不要用 PascalCase。`SettingsPopover.css` 是歷史遺留,新檔別跟。
- **colocated CSS 不要被別 feature import** — 出現第二個 feature 想用時,先升格到 `src/styles/`(順手 rename 成不撞 feature dir 名)再共享。

---
name: vibe-pipeline-frontend
description: vibe-pipeline 前端開發規範 — shell 結構、設計 token、共用元件、加新畫面 SOP、狀態 gallery 驗證、routing 慣例。改 src/features、src/shell、src/ui、src/styles、src/App.tsx 或加任何新畫面之前先讀。
---

## 開工前

1. root [`CLAUDE.md`](../../../CLAUDE.md) — repo 結構 / 雷區 / 設計信條 / 架構決策
2. 歷次大改動 / Phase 進度 → [`CHANGELOG.md`](../../../docs/CHANGELOG.md)

Phase 5 後 `src/` 加了 `features/auth/`(TOTP)+ `lib/fcm.ts`(Web Push)+ Settings 4-tab UI + 全套 mobile RWD(`@media (max-width:767.98px)`)。改這些段前看現有檔案,別憑記憶。

## UI 防禦規則(來自 runner real-run 踩到的雷)

Runner 寫進 pipeline.json 的欄位**不一定符合 type union 字面值**(主 agent 會自由發揮,即使 system prompt 寫死)。FocusColumn / TicketDrawer 渲染前要做 normalize:
- `iter.totalElapsed` 可能 undefined → 用 `?? 0`,別直接 `+ tick`(NaN)
- `iter.current` 可能 0(mid-run) → 顯示用 `Math.max(1, current)`
- `iter.stage` 可能寫成 "executing" / "reviewing" 等 → regex normalize 成 doer / critic / done(在 IterStages 內)
- `iter.verdicts` 可能 string `"PASS"/"FAIL"/"PARTIAL"` 或舊 mock 的 `1/0/-1` → Verdict type 雙格式,Verdicts 元件 case-insensitive
- `iter.rounds[*].criticVerdict` 同上,IterRounds 取 `.toUpperCase()`

## 技術棧

- Bun(套件管理 + 跑腳本)+ Vite 5 + React 18 + TypeScript(strict)
- React Router v6(BrowserRouter,query param 驅動變體)
- 不裝 Tailwind / CSS-in-JS。樣式全走 prototype 移植來的 CSS + tokens.css 變數
- **不開 `<StrictMode>`**(原因見「pitfalls」段)

## Shell 結構

```
AppShell (src/shell/AppShell.tsx)        ← Notifications / Board / Pipeline Create 用
├─ topBar    slot   (default: <TopBar/>)
├─ banner    slot?  (Notifications 用)
├─ rail      slot   (左側 pipeline 列表)
├─ main      slot   (中:FocusColumn / CreatePlaceholder / 其他)
├─ aside     slot?  (右:Inbox / 其他 panel)
└─ overlay   slot?  (Drawer / Modal)

EmptyShell (src/shell/EmptyShell.tsx)    ← Init 用
└─ children  (全屏自由排版)
```

`<TicketDrawer>` 與 `<QADrawer>` 自帶 `.drawer-stage` / `qa-drawer-backdrop`,不走 AppShell(它們是覆蓋型 overlay,自己處理背景)。

## Portal 慣例

任何「視覺上要全螢幕中央 / 浮在所有 UI 上」的元件 — `SyncConflictModal`、`PipelineHistoryDrawer`、Inbox preview popover、TopBar 手動路徑 / browse modal — **一律用 `createPortal` 渲染到 `document.body`**。

理由:祖先若有 `overflow: hidden`(`.inbox-col`、各 drawer panel)或 `transform: ...`(focus-head)會把 `position: fixed` 子元素 clip 在區域內;就近渲染肉眼看似置中但實際被切。Portal 出 body 才真正脫離祖先 stacking / clipping。

樣式統一(`board.css`):
- `.modal-backdrop` `position: fixed; inset: 0; z-index: 1000; background: color-mix(in srgb, #000 72%, transparent); display: flex; align-items: center; justify-content: center`
- `.modal-card` 內含 `.modal-title` / `.modal-body` / `.modal-actions`

寫新 modal / popover 前 → 直接用這套 class + `createPortal`,別自己刻 backdrop。

## src/ 內各層約定

> 物理結構樹 → root [`CLAUDE.md`](../../../CLAUDE.md) § Repo 內。本段只寫**為什麼這樣擺、什麼該放哪、什麼不該混**。

- **`features/{name}/`** 是大 feature 邊界。一個 feature 多檔(主 Screen + 子元件 + types)就獨立資料夾;單檔 < 200 行可只放 `{Name}Screen.tsx` 一檔
- **`shell/`** 只放跨 feature 共用的版面(AppShell slots、TopBar、Rail、EmptyShell)。**不放任何 feature 邏輯**
- **`ui/`** 是純展示的基礎元件(icons / Logo / PickerSelect / Button 等)。**不該知道任何 feature**
- **CSS import**:
  - 通用全域(tokens / board / notif)→ `main.tsx` 全域 import
  - feature 專用(qa / drawer / init)→ feature 元件最上面 `import "../../styles/qa.css"`,**別塞 main.tsx**
- **type 放哪**:
  - 跨 feature 共用 → `src/types/`(過渡;串接期持久化欄位將搬 `shared/types.ts`,UI-only 計算欄位留 `src/types/ui.ts`)
  - 單 feature 內用 → 該 feature 資料夾內
- **mock data 統一放 `src/data/`,不混 logic**。串接期改成從 `src/api/` fetch
- **`api/`** 每 endpoint 一個 `fetchXxx(): Promise<T>` 函式。**別在 component 裡 fetch URL 字面值**
- **`router/`** 集中 route 構造 helper(`buildPath.toBoard({project, pipeline})`),別讓字串散落各處

## Inline style 政策(對齊社群共識)

React 本身不禁 inline style,但社群有清楚的優先序:

**普遍禁止(universal anti-pattern)**:magic value
- `marginTop: 8`、`color: '#abc'`、`gridTemplateColumns: "130px ..."`
- 不論 inline 或 CSS class 都該走 token(`var(--space-2)` / `var(--accent)` 等)
- 違反本條 = 違反本 repo SKILL 既定政策(line 下方「設計 token」段)

**強烈建議走 CSS class**:多 property 堆積
- `style={{ display: 'flex', padding: 10, background: '...' }}` 這種 ≥ 3 properties 的塊狀 style
- 理由:可讀性、可重用、可 hover/focus/media query、render 不 churn 物件
- 抽進 feature 資料夾內 `<Feature>.css`,元件最上方 `import "./<Feature>.css"`

**允許 inline 的場景**:
1. **動態計算值**(由 props / state 算出,無法 class 靜態表達)— e.g. `style={{ transform: \`translateX(${offset}px)\` }}`
2. **單一 / 兩個 token 值的微調**— e.g. `style={{ color: 'var(--accent)' }}`、`style={{ marginTop: 'var(--space-3)' }}`
3. **conditional style 不便用 class 表達** — 但能 class swap 就 class swap

class 命名走 BEM-ish 或 feature prefix(避雷 #1 prototype 命名空間殘留),不 reuse prototype 留下的 class。

## 設計 token

`src/styles/tokens.css` 是從 prototype 1:1 移植過來的。**所有顏色、字型、spacing 都走 CSS 變數**,別寫 hex / px 原值。

主要變數:
- 背景: `--bg`, `--bg-elevated`, `--panel`, `--panel-2`
- 前景: `--fg`, `--fg-mute`, `--fg-faint`
- 線: `--line`, `--line-2`
- 互動: `--hover`, `--selected`, `--accent`, `--accent-soft`
- 狀態色: `--running` / `--iter` / `--done` / `--failed` / `--paused` / `--draft`(都有 `-soft` 版本)
- 字型: `--font-ui` (Geist + Noto Sans TC fallback), `--font-mono` (Geist Mono)
- shadow / radius 都有變數

主題切換靠 `<html>` 加 / 移 `light` class。深色是預設(無 class),`html.light` 覆寫變數值。

### Button CTA 三檔強度

`tokens.css` 內 button 三檔,視覺強度低 → 高:

| Class | 樣式 | 用途 |
|---|---|---|
| `btn` | panel-2 灰底 + line border | 中性 / 純功能(取消 / overflow menu / 純資訊按鈕)|
| `btn-accent` | 透明 accent 10% 底 + accent 邊 + accent 字 | **次要 CTA**,跟主 CTA 並排時用(e.g. `+ ticket` 在 RunButton 旁邊) |
| `btn-primary` | accent 填 + 白字 | 主動作(RunButton 開始/繼續/重試/停止;empty pipeline 的 + ticket)|

**RunButton 單按鈕原則**(2026-05-17 簡化):pipeline header 的 RunButton **永遠單一顆**,按其 label 隨 state 切換 — `idle/paused/failed/failed_transient` → 「開始 / 繼續 / 重試」(primary action 觸發 run);`running` → 「停止」(immediate SIGKILL → state=paused,沒有 graceful / 兩段式 / 「停止中」chip)。**不准回退成雙按鈕或加 stopping 中介態**;對應 backend 規則見 `vibe-pipeline-backend` SKILL § Runner。

**重置 pipeline**(2026-05-20):FocusColumn overflow menu 單一「重置 pipeline」(不是「清 worktree」+「重跑全部」雙 button)。動作:刪 worktree dir + `git branch -D pipeline/<name>` + tickets done/failed → draft + state=planning。語意:整條 pipeline 砍掉重練,不只清 worktree(清 worktree 後 branch 還在,啟動會落後 base N commits)。

**互斥規則**:同一視覺區域內**最多一顆 btn-primary**。範例:`+ ticket` 跟 `RunButton` 在 pipeline header 並排 — pipeline 有 ticket 時 RunButton 是 primary、+ ticket 降 `btn-accent`;沒 ticket 時 RunButton disabled,+ ticket 升 primary。避免兩顆都搶眼 user 不知按哪個。

## 共用元件

### `src/ui/icons.tsx`
- 已有: `PlusIcon` / `SearchIcon` / `BellIcon` / `GearIcon` / `FolderIcon` / `ChevronIcon` / `ChevronLeftIcon` / `ChevronRightIcon` / `CheckIconSm` / `CheckIcon` / `WarnIcon` / `MergeIcon` / `CheckCircleIcon` / `CloseIcon` / `InboxEmptyIcon` / `FolderQuestionIcon` / `CopyIcon` / `RefreshIcon` / `BookIcon` / `SpinnerIcon`
- `BannerIcon({kind, small})` — kind: `warn` / `alert` / `check` / `skill` / `iter` / `dot`
- 加新 icon **先去 icons.tsx 看有沒有**,沒有才加

### `src/ui/Logo.tsx`
品牌 logo,接 `size` prop。

### `src/ui/PickerSelect.tsx`
下拉選單,有 outside-click + Esc 關閉。`{open, setOpen, value, onChange, options, icon}` props。`options: PickerOption[]` 含 `id, label, hint?, mono?`。

## 加新畫面 SOP

phase 3-5 後 prototype variant + pixel-diff 已砍。新畫面流程:

1. **找可重用元件**: 先翻 `src/ui/`、`src/shell/`、`src/features/pipeline/`,別重發明
2. **建 component**: `src/features/X/XScreen.tsx`,接真 backend(`api.*`)— 不再 mock
3. **加 CSS**: 用 `tokens.css` 變數,別寫 hex / px 原值
4. **加 route**: 在 `src/App.tsx` 加 `<Route>`,用 `useTheme()` 同步 theme
5. **加 TS exhaustive switch**:`switch (s) { case ... } default: const _: never = s`,加新 state 沒接 case 編譯就 fail

## Pitfall

root [`CLAUDE.md`](../../../CLAUDE.md) §不踩的雷 是全 repo 公用,本段只列 src/ 特有:

1. **新 feature 避開 prototype 命名空間殘留** — `src/styles/qa.css` 是 prototype 留的 `.qa-*` class(含 `.qa-body { display: grid }`)。Phase 2 加 QADrawer 用 `.qa-body` 被 grid 拉伸 bubble 高度暴增。修法:新 feature 走獨立 prefix(QADrawer 用 `qadr-*`),不要 reuse prototype class

## Routing 慣例

跨畫面共享 state 全走 URL query param(refresh 不掉、bookmark 帶完整 context)。例外:`active project hash` 走 localStorage、`theme` 走 localStorage(URL `?theme=` 仍 override)。

主要 route:
- `/` → redirect `/board`
- `/board` 主畫面;`?project=<hash>&pipeline=<id>&ticket=<id>` 帶 context
- `/setup` / `/login` TOTP

`STATE_COLOR` / `STATE_LABEL` / `SEV_COLOR` / `fmtElapsed` 在 `src/data/` 是純 helper(原本的 mock seed 已全砍);新 helper 可加進這層。

## API 串接慣例

### Vite proxy

`vite.config.ts` 設 `server.proxy['/api'] = 'http://127.0.0.1:3001'`,前端只打 `/api/*` 相對路徑,自動轉去 backend。

### Fetch / 資料層

**不引 react-query / SWR / Redux**(避免架構爆炸)。第一刀走最簡:
- 建 `src/api/` 目錄,每個 endpoint 一個 `fetchXxx()` 函式回 `Promise<T>`
- 在 component 用 `useEffect + useState` 自管 loading / error
- polling / refetch 重複模式 → 用 `src/hooks/useApi.ts`(已存在)。簽名:`useApi(fetcher, { intervalMs?, gate?, idleMs?, refetchOnVisible?, deps?, cacheKey? })`,回 `{ data, error, refetch }`。已在 BoardScreen(notifs / pipelines / config)、FocusColumn(diffStat / syncStatus)、useQA(draft poll)用,新 polling component **先 reuse 別重發明**
- **useApi 用法雷**(2026-05-20 踩過,別再來):
  - `deps` **只放 primitive**(string / boolean / number)。放 object ref(`project` / `pipeline`)會被 parent setState 拿新 ref 觸發 trigger refire,造成 mount fetch 完馬上又 fetch 一次(看到「同 endpoint 連續 2 次」)。改 `[project?.hash, project?.hasInit]` 等 primitive 解
  - `intervalMs` 別小於 5s(對打 git 的 endpoint 至少 10s,**merged pipeline 完全 gate 掉不 poll**)。每個 git endpoint 一次 fork 多個 helper,Windows 上炸視窗(無 windowsHide 場景)+ 消耗 CPU
  - `refetchOnFocus` 已拔 — `window.focus` 在「DevTools 點回 page / 切視窗」噪音太多,visibility + intervalMs 就夠
  - polling 用 `setTimeout` self-reschedule 不用 `setInterval`(已內建)— Chrome tab freeze 場景 setInterval callback 排隊,resume 一次爆量;self-reschedule 自然無排隊
  - **300ms dedupe**:visibility + focus 雙觸發 / 同 deps 改值連續 setState 的場景內建 dedupe(已內建,不必自己擋)
- **SW first-install 不 force reload**(`src/lib/swUpdate.ts`,2026-05-20):`navigator.serviceWorker.controller` 在 SW 首次 install 時是 null。`controlling` event handler 內 `hadController` flag captured at register time,**只在 hadController=true 時 reload**(已有 SW 換新版才 reload);first-install 不 reload 避免所有 component 二度 mount(撞「mount-1.5s 內每 endpoint fire 2 次」)

之後若 cache invalidation / refetch / optimistic update 變痛了,**再考慮**引 react-query。**不要預先設計**。

### Type 共用

backend 是 schema authority。**不要前端 `src/types/` 跟 backend 各維護一套**。

短期過渡:
- backend 端定 `shared/types.ts`(由 backend SKILL 規範位置)
- 前端 import 同檔
- monorepo 結構:`shared/` 在 root,前後端都 `import "../shared/types"`

**目前 `src/types/pipeline.ts` 與 `src/types/notif.ts` 是過渡狀態**:加了 UI-only 計算欄位(如 `iter.totalElapsed`、`liveLog`)。串接時:
- 把「持久化欄位」抽到 `shared/types.ts`(backend 為主)
- UI-only 計算欄位放 `src/types/ui.ts` 並 extends 持久化 type

### Endpoint 命名

- `GET /api/projects`
- `POST /api/projects/select`
- `POST /api/projects/:hash/init`
- `GET /api/projects/:hash/pipelines`
- 等。完整列表在後端 SKILL「stub-first 起手」段

### 錯誤處理

backend 一律回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。前端的 `fetchXxx()` 在 ok=false 時 throw,讓 useEffect 的 catch 接。**別把 4xx 當例外丟,正常流程也可能回 not_found**(例 init popup 偵測 .vibe-pipeline/ 不存在是預期狀態,不是錯)。

## 跨畫面 navigation + state

### URL 是 source of truth

跨畫面共享的 state(active project / theme / 當前看哪個 pipeline)**全走 URL query param 或 path**。不要塞 React Context 或 global store。理由:
- pixel-diff 已經靠 query param 驅動變體,連續性
- refresh 不掉 state
- bookmark / 分享連結直接帶完整 context

例:
- `/board?project=a3b4f1e2` — 看哪個 project
- `/board?project=a3b4f1e2&pipeline=feat-auth` — 看哪條 pipeline
- `?theme=dark` — 主題

例外:**會頻繁變動但不需要 URL 反映**的(如 banner 動畫狀態、未讀計數的本地 optimistic 值)用 component state 即可。

### 跨 route 的真正全域 state

只兩個:
- **`active project hash`** — `useActiveProject()` hook,讀 URL `project` param;當沒 param 時 fallback 到 `localStorage.lastProject` 並重定向到 `?project={hash}`
- **`theme`** — 已實作(URL `theme=` + `index.html` 同步 script)

其他都別放全域。

### Navigation 慣例

- 用 `useNavigate()` 跳 route(不用 `<a href>`,除非真要新分頁)
- 跨畫面跳轉**保留 query param**(`navigate(\`/drawer?project=\${project}&ticket=\${id}\`)`)
- 寫一個 `src/router/buildPath.ts` helper 集中所有 route 構造,避免散落字串

## PWA(Workbox + FCM 合併 SW)

2026-05-17 起 build 走 vite-plugin-pwa `injectManifest`,跟既有 `firebase-messaging-sw.js` 合併為單一 SW。改 SW / install UX / manifest 前先看本段。

### SW 檔位置與來源

- **來源**:`public/firebase-messaging-sw.js`(repo 內,手寫)
- **build 後**:`dist/firebase-messaging-sw.js`(plugin 把 `self.__WB_MANIFEST` inline,SW 路徑跟檔名都不變)
- **dev mode 不發 SW**(見 [`.claude/rules/pwa-sw.md`](../../../.claude/rules/pwa-sw.md))— `bunx vite` 5173 dev server 上 SW 不註冊,改邏輯後一律 `bun run build && bun run server`(backend 同 serve dist/ on 3001,SW 在 dist/ 內生效)驗

### vite.config.ts plugin 設定要點

```
VitePWA({
  strategies: 'injectManifest',
  srcDir: 'public',
  filename: 'firebase-messaging-sw.js',
  injectRegister: false,                       // 註冊由 src/lib/fcm.ts 管,不讓 plugin 搶
  injectManifest: { maximumFileSizeToCacheInBytes: 5_000_000 }
})
```

`injectRegister: false` 是關鍵:plugin 不自己生 register script,SW 註冊仍由 `src/lib/fcm.ts:99`(`navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })`)在 user 啟用 push 時做。

### registerType: prompt(user 主動觸發更新)

`registerType: 'prompt'`(非 `autoUpdate`):SW 新版背景 install + 進入 `waiting`,**不會 force reload**,等 user 點 banner 才 `messageSkipWaiting` → controlling event → `window.location.reload()`。為何不走 autoUpdate 見 [`.claude/rules/pwa-sw.md`](../../../.claude/rules/pwa-sw.md) §autoUpdate force reload。

實作三檔:

- **`src/lib/swUpdate.ts`** — workbox-window 包裝。`registerSW()` 在 app boot 時呼叫一次(`src/main.tsx` / `App.tsx`),建 `Workbox('/firebase-messaging-sw.js')` 監聽 `waiting` / `controlling` / `activated`;`updateSW()` 對外 API 觸發 skip waiting + reload;`useSwUpdate()` hook 給 component 用,回 `{ needRefresh, offlineReady, updateSW }`。state 是 module-scoped(多 component 共享同一份 needRefresh 不重複 register)
- **`src/features/system/SwUpdateBanner.tsx`** — UI。`useSwUpdate()` 拿 `needRefresh`,顯「有新版可更新」+「更新」(`btn-primary`)+「×」(本地 dismiss)。塞在 AppShell topBar 下方 / 適當全域位置一份就好
- **掛載點** — banner 是全 app 跨畫面狀態,不要在單 feature 內 mount(避免換頁就消失)

### 開發者改 SW 後測試流程

[`.claude/rules/pwa-sw.md`](../../../.claude/rules/pwa-sw.md) 已寫 SW 只 production 註冊。配合 prompt mode 完整驗證流程:

1. `bun run build && bun run server` → 開 `http://localhost:3001/`
2. 第一次進 PWA(可加進主畫面 / 用瀏覽器分頁均可)— SW install + activate,Application → Service Workers 看 `activated and is running`
3. 改 `public/firebase-messaging-sw.js` 任一行(加 comment 即可觸發 hash 變更)
4. 再 `bun run build`(backend 仍跑著,serve 新 dist/)→ 切回瀏覽器分頁 → reload 該頁
5. 預期:SW 新版進 `waiting` 狀態(Application → Service Workers 看到「waiting to activate」),`<SwUpdateBanner>` 顯「有新版可更新」
6. 點「更新」→ controller 切換 → 頁面 reload → 新版 SW 接管

若 banner 沒跳:檢查 (a)`registerSW()` 確實在 app boot 有被呼叫(console 無 register 錯誤),(b) SW 內容真的有變(workbox 比對 hash,純註解可能被 build 優化掉,改實質字串如版本號最保險),(c) DevTools Application → Service Workers 勾「Update on reload」會跳過 waiting,debug 時關掉。

### SW 內部三段共存

`public/firebase-messaging-sw.js` 從上到下:

1. **Workbox precache** — `precacheAndRoute(self.__WB_MANIFEST || [])`
2. **Workbox runtime cache**(4 條 `registerRoute`)
   - NavigationRoute → fallback `/index.html`
   - `/api/health` → NetworkOnly(在 /api/* 規則前,避免被 catch-all 蓋)
   - `/api/*` GET → **NetworkOnly**(2026-05-19 refactor pipeline 改;原 SWR 對 polling endpoint 引入「先顯舊再閃新」flicker。activate handler 順手 `caches.delete("api-cache")` 清舊 cache。詳見 [`.claude/rules/pwa-sw.md`](../../../.claude/rules/pwa-sw.md) §Workbox runtime cache /api/* 已 NetworkOnly)
   - `fonts.googleapis.com` → SWR
   - `fonts.gstatic.com` → CacheFirst
3. **FCM 段** — `importScripts(firebase-app + firebase-messaging)` + `messaging.onBackgroundMessage` + push event listener + `notificationclick` + `install`/`activate` 的 `skipWaiting()`/`clients.claim()`

改任何一段都跑 `bun run build` 看 precache entries 數變化 + 開 `dist/firebase-messaging-sw.js` 確認另兩段還在(理由見 [`.claude/rules/pwa-sw.md`](../../../.claude/rules/pwa-sw.md) §改 SW 要兩段都驗)。

### Install prompt UX

- `src/hooks/useInstallPrompt.ts` — 監聽 `beforeinstallprompt`(`preventDefault` + 存 event)、`appinstalled`、`matchMedia('(display-mode: standalone)')`,回傳 `{ canInstall, isInstalled, isBusy, promptInstall }`
- `src/features/settings/SettingsPopover.tsx`「PWA」tab(原「通知」改名)頂端 `<InstallAppSection>` 用上述 hook
  - 已安裝 / 不支援 → disabled + 文字提示
  - iOS Safari fallback 顯「請用分享 → 加入主畫面」hint

### manifest

- 手寫的 `public/manifest.json` 是 `index.html` 唯一 link 的 manifest(name / short_name / start_url / display:standalone / theme_color #d4956d / background_color / icons + 新增 description / lang `zh-Hant` / dir / orientation `any` / categories `[productivity, developer]` / shortcuts:看 Board → `/board`,設定 → `/?settings=1`,各帶 192 icon)
- plugin 會另外產一份 `manifest.webmanifest`,**並存但不 link**(避免 plugin 不認手寫欄位導致資訊掉)

### Lighthouse 驗收

```
bun run build && bun run server
# 開 http://localhost:3001 → DevTools → Lighthouse → PWA category → Analyze
```

目標 ≥ 90。Installable / SW / manifest 三條 check 都要過。改 manifest / SW / icon 後固定跑一次。

## 觸發本 SKILL 的場景

- 改 `src/features/*` / `src/shell/*` / `src/ui/*` / `src/styles/*` / `src/App.tsx`
- 加新畫面 / 新 route / 新 modal / popover
- 動 token / theme / button 強度分級
- 改 mobile RWD 或 portal 行為
- 改 PWA / SW / manifest / install prompt(對應「PWA(Workbox + FCM 合併 SW)」段)

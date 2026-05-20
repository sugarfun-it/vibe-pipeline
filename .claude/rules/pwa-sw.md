---
paths:
  - public/firebase-messaging-sw.js
  - vite.config.ts
  - src/lib/swUpdate.ts
  - src/lib/fcm.ts
  - src/features/system/SwUpdateBanner.tsx
description: PWA / Service Worker / Workbox / vite-plugin-pwa 改動時的雷區
---

# PWA / Service Worker 雷區

改 `public/firebase-messaging-sw.js`、`vite.config.ts` 內 PWA 段、Workbox runtime cache、SW 註冊 / 更新流程前讀。

## vite-plugin-pwa 只在 production build 註冊 SW

dev mode `bun run dev`(5173)SW 不註冊(plugin 預設行為),改 SW 邏輯要 `bun run build && bun run preview` 才看得到效果。改完用 4173 preview port 測,別在 5173 dev 找不到 SW 就懷疑 plugin 壞了。Lighthouse PWA / 安裝提示 / precache 行為也只在 4173 才驗得到。

## firebase-messaging-sw.js 合併 Workbox 後改 SW 要兩段都驗

同一個 SW 同時跑 Workbox precache / runtime cache 跟 FCM push handler(`public/firebase-messaging-sw.js` 由 vite-plugin-pwa injectManifest 注入 `self.__WB_MANIFEST` 後輸出到 `dist/firebase-messaging-sw.js`)。改 SW 程式碼時:

- precache 改動 → 跑 `bun run build` 看 entries 數變化(目前 9 entries / ~640 KiB)
- push handler 改動 → 看 dist 產出的 sw 裡 push event listener 還在 + `event.waitUntil(showNotification(...))` 還在

**Android push 行為**(SW + Notification 兩段):

1. 混合 `notification+data` payload **不會 auto-display**,push handler 必須自己 `event.waitUntil(showNotification(...))`
2. 前景訊息用 `ServiceWorkerRegistration.showNotification()`,**不能**用 `new Notification()` page constructor(Android Chrome 不認)。`src/App.tsx` `useFcmBootstrap` 已先試 SW reg,desktop fallback 才用 page constructor

## Workbox runtime cache `/api/*` 已 NetworkOnly 完全不 cache

`/api/*` GET 一律走 `NetworkOnly()`,**不 cache**。原因:VP polling endpoint(pipelines / notifs / runtime,3-5s 一次)套 SWR 會「先顯舊 cache(0ms)→ 背景 refresh → 下次 fetch 才看到新值」造成「慢一拍 / 先顯舊再閃新」flicker,對 online-first 場景(localhost / Tailscale)cache 價值小於 flicker 痛。

離線時 `/api/*` fetch 會 fail,但 UI shell(precached `index.html` + JS bundle)仍能載入,只是資料區呈現 error / empty state。

歷史:v5 之前用 `StaleWhileRevalidate({ cacheName: "api-cache" })`,v6 改 NetworkOnly 並在 activate handler `caches.delete("api-cache")` 清舊 cache。若未來要重啟 cache 策略,**只能對 read-only 且不會 polling 的 endpoint 套**,polling endpoint 永遠 NetworkOnly。

非 GET(POST/PUT/DELETE/PATCH,`/api/run` `/pause` `/merge` `/qa/turn` `/ticket update` 等 mutation)本來就不在 GET filter 內,走網路直通。Google Fonts 兩條 route(CacheFirst / SWR)同理只應命中 GET。

## vite-plugin-pwa `registerType: 'autoUpdate'` 會 force full reload

workbox-window 預設 `controlling` event 觸發 `window.location.reload()`,user 正在打字 / 看 modal / 跑 QA 都被打斷,體感「跟突然 refresh 一樣」。VP 改用 `registerType: 'prompt'` + `<SwUpdateBanner>` 讓 user 主動點「套用更新」才 reload(`src/lib/swUpdate.ts` 用 workbox-window 自管 `needRefresh` state + `messageSkipWaiting`)。

要改回 `autoUpdate` 前先確認 user 體感 OK — 設計信條:**執行中操作信號才該立即冪等**,「自動 reload」由 backend 替 user 決定打斷時機,不對等。

**Settings 「更新」tab 跟 `SwUpdateBanner` 按鈕分開語意**(改前考慮整條 flow):

- Settings 更新 tab 按鈕 = 「**更新**」 — 走 backend `git pull` + `bun install` + `bun run build` + 重啟(server 端 fetch + apply 全流程)
- `<SwUpdateBanner>` 按鈕 = 「**套用更新**」 — 走 `messageSkipWaiting + reload`(client 端 SW 換 bundle 那一步)

Flow:user 在 Settings 按「更新」→ backend 跑完 build + 重啟 → 新 bundle 由 Workbox 偵測 → `<SwUpdateBanner>` 出現「套用更新」→ user 按它 reload 拿新 bundle。**兩按鈕是同一 update flow 的兩階段**,「更新」抓 + 「套用更新」應用,語意分開。

## mobile drawer / 全螢幕用 `100dvh` 不要 `100vh`

`100vh` 在 Android Chrome 算上 nav bar 區域,底部 input 被遮。需要:

- `viewport-fit=cover`(已在 index.html 設)
- CSS 用 `100dvh`(留 `100vh` 當 fallback)
- drawer-stage z-index ≥ 50(高過 `.board-mobile-tabs` 的 40)

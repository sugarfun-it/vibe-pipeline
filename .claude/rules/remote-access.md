---
paths:
  - server/index.ts
  - server/lib/remote/push/**
  - server/lib/remote/fcm.ts
  - .env
  - .env.example
description: 手機遠端 setup(Tailscale + FCM)相關雷區
---

# 遠端存取雷區

改 push / FCM / network binding / CORS 設定前讀。背景見 [`README.md` §遠端存取](../../README.md)。

## VP 無 app-level auth — Tailscale 是唯一存取邊界(2026-05-24)

TOTP / cookie / session 已整層拔除(`server/lib/auth/**`、`server/routes/auth.ts`、`/setup` `/login` 路由、`auth.json` 全砍)。安全 model 變單層:

- **Tailscale ACL + tailnet membership** 是唯一存取控制 — 同 tailnet 內任何 device 都能直連 VP backend,沒第二層 OTP gate
- 適用場景:single-user 自己的 tailnet。**不要把 VP 放進 shared tailnet**(家人 / 同事 / 公司網)— 沒 auth 層擋,任何 tailnet member 都能讀寫 pipeline / 改 ticket / 触發 AI run
- 若未來要加回 app-level auth,別用 TOTP-cookie 那條(完整理由見 `docs/refs/archive/auth-removal-2026-05-24.md` 若有);考慮 mTLS / Tailscale serve `--funnel=false` + per-device share 或更輕的 PIN
- enduser disk 上的 `~/.vibe-pipeline/auth.json` 若仍存在是 orphan,可手動 `rm` 清,backend 不再讀寫

## Tailscale HTTPS 不可省

FCM service worker 要 secure context,`http://100.x.x.x:3001` 不算 secure → push 訂閱不會註冊。手機必須走:

```
tailscale serve --https=443 http://localhost:3001
```

backend 同 serve API + dist/ PWA,單一 port 3001;SW 只在 build 後的 `dist/index.html` 跟 `firebase-messaging-sw.js` 內生效,確保 `bun run build` 後再走 Tailscale(見 `rules/pwa-sw.md`)。

## `server/index.ts` 必須 `0.0.0.0` 監聽

改回 `127.0.0.1` 手機連不到,Tailscale 介面也算非 loopback。

## `ALLOWED_ORIGINS` 不要放 `*`

無 app-level auth 後 CORS 是僅存的 web 邊界,Tailscale tailnet 不該假設絕對安全;放 `*` 等於允許任何頁面 cross-origin 打 backend。

## 離線 push 補送靠 FCM 不靠 VP

手機離線時 FCM server 暫存 28 天,VP 端不做 queue;debug 時別找 VP backend 的 queue,沒有。

## Push 走 maintainer gateway,enduser 零設定

2026-05-19 起 VP backend 拔掉 `firebase-admin`,改 POST maintainer host 的 push gateway(`https://vp-gateway-799841449136.asia-east1.run.app`,Cloud Run asia-east1 / max-instances=1 / $1/mo budget alert)。同日 lazy auto-issue 落地後,enduser **完全零設定**:Firebase Web SDK config + gateway URL hardcode 進 build,token 自動跟 gateway 申請。

- enduser `.env` 不必填任何 push 相關 var;Firebase config 跟 gateway URL 由 `src/lib/fcm.ts` `DEFAULT_FCM_CONFIG` 跟 `server/lib/remote/fcm.ts` `DEFAULT_GATEWAY_URL` 內建(`VITE_FCM_*` / `PUSH_GATEWAY_URL` env 仍可 override 給 forker)
- token lazy 取得:`server/lib/remote/push/gatewayToken.ts` SSOT 在 `~/.vibe-pipeline/gateway-token`(atomic .tmp→rename + posix chmod 0600 + in-flight Promise 合併並發);`tokenStore.register/unregister` 進入點呼 `ensureToken` → 沒檔 → POST gateway `/tokens/auto-issue`(無 auth,IP rate-limit 5/UTC day);`listTokens` 走被動 `getToken` 不誤觸 issue
- `server/lib/remote/fcm.ts` `fanoutPush` 改 `getToken` 取本地檔;`PUSH_GATEWAY_TOKEN` env 仍是 read-only override(forker / CI 用)
- 沒拿到 token → `fanoutPush` warn + return [],不報錯;backend 啟動正常
- 死 token 偵測由 gateway 端 Firestore registry 做;`tokenStore` 本地不存 device tokens
- gateway source 在 repo 內 `gateway/`(Bun + Firestore + firebase-admin),含 `/tokens/auto-issue` 端點 + `vp-gw-admin` 管理 CLI;deploy 步驟見 `gateway/README.md`
- 舊「enduser 自己開 Firebase」path 已 deprecated,不要回頭加 firebase-admin 到 server/

完整 spec / 取捨 → [`docs/refs/archive/fcm-push-gateway-2026-05-17.md`](../../docs/refs/archive/fcm-push-gateway-2026-05-17.md)。

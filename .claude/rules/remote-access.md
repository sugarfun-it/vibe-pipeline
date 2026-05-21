---
paths:
  - server/index.ts
  - server/lib/auth/**
  - server/lib/push/**
  - server/lib/fcm/**
  - .env
  - .env.example
description: 手機遠端 setup(Tailscale + TOTP + FCM)相關雷區
---

# 遠端存取雷區

改 auth / push / FCM / network binding / CORS 設定前讀。背景見 [`README.md` §遠端存取](../../README.md)。

## Windows `auth.json` NTFS ACL chmod 0o600 不生效

`~/.vibe-pipeline/auth.json` 存 TOTP secret 雜湊,程式 `fs.chmod(0o600)` 在 Windows NTFS 沒效果。個人 PC 單帳戶 OK(user profile 預設已隔離),多帳戶 / 工作機要手動右鍵 → 安全性 → 移除 Users/Everyone。

## Tailscale HTTPS 不可省

FCM service worker 要 secure context,`http://100.x.x.x:3001` 不算 secure → push 訂閱不會註冊。手機必須走:

```
tailscale serve --https=443 http://localhost:3001
```

backend 同 serve API + dist/ PWA,單一 port 3001;SW 只在 build 後的 `dist/index.html` 跟 `firebase-messaging-sw.js` 內生效,確保 `bun run build` 後再走 Tailscale(見 `rules/pwa-sw.md`)。

## `server/index.ts` 必須 `0.0.0.0` 監聽

改回 `127.0.0.1` 手機連不到,Tailscale 介面也算非 loopback。

## `ALLOWED_ORIGINS` 不要放 `*`

TOTP 是 auth 層但 CORS 也是邊界,Tailscale tailnet 不該假設絕對安全。

## 離線 push 補送靠 FCM 不靠 VP

手機離線時 FCM server 暫存 28 天,VP 端不做 queue;debug 時別找 VP backend 的 queue,沒有。

## Push 走 maintainer gateway,enduser 零設定

2026-05-19 起 VP backend 拔掉 `firebase-admin`,改 POST maintainer host 的 push gateway(`https://vp-gateway-799841449136.asia-east1.run.app`,Cloud Run asia-east1 / max-instances=1 / $1/mo budget alert)。同日 lazy auto-issue 落地後,enduser **完全零設定**:Firebase Web SDK config + gateway URL hardcode 進 build,token 自動跟 gateway 申請。

- enduser `.env` 不必填任何 push 相關 var;Firebase config 跟 gateway URL 由 `src/lib/fcm.ts` `DEFAULT_FCM_CONFIG` 跟 `server/lib/fcm/index.ts` `DEFAULT_GATEWAY_URL` 內建(`VITE_FCM_*` / `PUSH_GATEWAY_URL` env 仍可 override 給 forker)
- token lazy 取得:`server/lib/push/gatewayToken.ts` SSOT 在 `~/.vibe-pipeline/gateway-token`(atomic .tmp→rename + posix chmod 0600 + in-flight Promise 合併並發);`tokenStore.register/unregister` 進入點呼 `ensureToken` → 沒檔 → POST gateway `/tokens/auto-issue`(無 auth,IP rate-limit 5/UTC day);`listTokens` 走被動 `getToken` 不誤觸 issue
- `server/lib/fcm/index.ts` `fanoutPush` 改 `getToken` 取本地檔;`PUSH_GATEWAY_TOKEN` env 仍是 read-only override(forker / CI 用)
- 沒拿到 token → `fanoutPush` warn + return [],不報錯;backend 啟動正常
- 死 token 偵測由 gateway 端 Firestore registry 做;`tokenStore` 本地不存 device tokens
- gateway source 在 repo 內 `gateway/`(Bun + Firestore + firebase-admin),含 `/tokens/auto-issue` 端點 + `vp-gw-admin` 管理 CLI;deploy 步驟見 `gateway/README.md`
- 舊「enduser 自己開 Firebase」path 已 deprecated,不要回頭加 firebase-admin 到 server/

完整 spec / 取捨 → [`docs/refs/archive/fcm-push-gateway-2026-05-17.md`](../../docs/refs/archive/fcm-push-gateway-2026-05-17.md)。

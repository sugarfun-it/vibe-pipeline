# Changelog / 決策日誌

歷史紀錄 + 設計決策來源。CLAUDE.md 是「現狀規則」,本檔是「為何變成現狀 / 過去考慮過什麼」。

寫入規則:每次架構級改動或設計決策落地往**後 append** 日期分段(舊在上、新在下);CLAUDE.md 只更動 canonical reference 段。每個 bullet 一個概念,非顯而易見的 why 加一句。

---

## 2026-05-13(Phase 5 後續打磨)

- Sync 重構(Plan C):`Pipeline.syncJob` 寄生欄位取代舊 `mode=sync` ticket;git-first → 衝突才 AI
- `subAgent` 拆 `executor` + `critic`:critic 可挑便宜 model 省 token 5-10x;userConfig 自動 migrate
- Client-side folder browser:Tailscale 遠端開 project 走 `GET /api/projects/browse`,native picker 失效改瀏覽器內導覽
- `vbpl` CLI 落地:`cli/` 內 reuse `server/lib/*` 直存 fs(no HTTP),4 nouns + `--json` mode
- Auto-merge 二段式:先 `git merge --no-ff`(~90% clean case 毫秒級);撞衝突自動 fallback AI + FCM push
- Manual merge 對稱 git-first:`mergePipeline` 改先試 mechanical;response 加 `mode: "mechanical" | "ai"` discriminator
- CLI mutate 走 backend HTTP:`run / stop / merge / sync` 走 POST,避免 CLI 退出後 child 孤兒
- `Pipeline.createdAt`:取代 id 內嵌 hex timestamp 當排序依據(AI 手 craft 假 id 會排亂)
- `pipelineDir.init` 改 idempotent:partial 殘骸自動補齊;`.gitignore` 自動補 `pipelines/`
- UX 收斂:Pipeline 執行紀錄拆 OverflowMenu;CTA 三檔強度(`btn` / `btn-accent` / `btn-primary`)互斥
- 主 SKILL 重定位:從 maintainer doc 改成 enduser AI 操作手冊;refs 搬 `docs/refs/`,SKILL 變 distributable

---

## 2026-05-14

- `cost_limit_usd` enforcement 改 per-pipeline 累積:不再跨 pipeline 加總互擋
- Provider 鏈一致化:主 agent 是 X → sub-agent 跟著 X;executor / critic / merge 全 snap 成 `runner.provider`
- codex 主 runner 改 in-process `spawn_agent` pattern:需 `[features] multi_agent = true`;達到 claude-claude 同級 in-process 速度
- `coerceConfig` silent snap migration:讀 config 自動 snap provider 一致;PUT mismatch 擋掉
- Background push 真實 pipeline 事件觸發 e2e 驗證(vp-autotest `push-verify`)
- Push event per-type toggle:`pushEvents` 4 key(ticket_done / ticket_failed / pipeline_paused / auto_merge_conflict)
- `vbpl pipeline log --follow`:tail -f 模式,debug pipeline 卡 / 看 runner 進度
- runner prompt 重構:iter step 1 寫 partial round 修 elapsed 00:00 假象;dispatchProtocol 抽共通段 ~20KB→~17.6KB;砍 transient retry dead code
- Phase 6 候選大幅收斂:5 項評估後砍(個人 vibe 工具不需 / 邏輯矛盾 / free mitigation 已夠);剩 iOS PWA push 實測

---

## 2026-05-17

- PWA Workbox 整合(`pwa-workbox`):vite-plugin-pwa injectManifest 跟 firebase-messaging-sw.js 合併為單一 SW;precache(9 entries / ~640 KiB)+ runtime cache(`/api/*` SWR / Google Fonts / Navigation fallback)。dev mode 不註冊 SW,要 `bun run build && bun run preview` 才驗
- PWA `registerType: autoUpdate → prompt`(`pwa-update-prompt`):原 autoUpdate 體感像突然 refresh;改 prompt + `<SwUpdateBanner>` 等 user 主動點才 reload
- Pause 路徑簡化:`stopping` 中介 state 全拔,stop = SIGKILL → paused immediate。動機:按停止就想立刻停,等 ticket 跑完反直覺;graceful 三層分支維護不對稱。設計信條「執行中操作信號 = 立即 + 冪等」

---

## 2026-05-18

- `ensureDepsAfterMerge`:merge 後 diff `package.json` deps + `bun.lock`,變動就 `bun install`(失敗 emit notif 不阻斷)。背景:self-dogfood pipeline 加新 dep merge 回 main 後撞「Cannot find package」
- `bun run start` enduser script vs `dev` maintainer script 拆;`sub:*` script +100 port(5273 / 3101 / 4273)給 sub-agent 自起 stack
- CLAUDE.md 瘦身 285→89 行:物理 tree 抽 `repo-structure.md`(SSOT);refs 表抽 `refs/README.md`;手機遠端段刪指 README
- `docs/TODO.md` 落地 + Phase 8 pipeline `019e36fbea63-phase8` 開:14 項候選收一處
- Settings full-redesign + pixel-polish 全 revert(`8bb47fb` / `09af96d` / `24dcf5c`);backup branch `backup/settings-pixel-polish-pre-revert` 保留。reason:redesign 後元素全放大 ~1.5x,實用時「各種元素都好大」+「兩 tab 樣式不一致」。經驗:**mockup-driven AI polish 容易過度 scale + 失去既有 design language**,critic 不會抓
- Frontend toast → Inbox emit 拔:BoardScreen 只走 `setActionError`(5s toast),不再 `postNotif`。reason:user 反問「前端動作不該進 Inbox」
- 文件 / SKILL 結構重整:跨檔「雷 #N」brittle 引用改 §descriptive anchor(13 處);AGENTS.md 砍到 9 行純 pointer(SSOT 回 CLAUDE.md dir 表);`.claude/rules/` 新增 path-specific 規則檔(pwa-sw / remote-access / cli-codex);`docs/refs/` active 14 → 5 個 + archive 6 → 17;CHANGELOG 精煉收斂 + 結構整理(已 final / 計畫 ref 段上移到日期 entries 前)

---

## 2026-05-19

- `vbpl server` 系列落地:enduser / AI 以 `vbpl server start|status|logs|restart|stop` 管 backend,不再要求記 `bun run server` 或留 terminal 掛著
- CLI mutating commands auto-start backend:`pipeline run|stop|merge|sync` 透過 local start lock 防 race,同時兩個 CLI 只會 spawn 一個 backend
- Windows detach 驗證補齊:`Bun.spawn(..., detached:true, stdio:file, windowsHide:true)` 關 terminal 不帶死 backend;避免 Node #36808 / `fork` 類 IPC detach 雷
- Backend access log 加上 `[access] METHOD /api/... STATUS Nms`,讓 `vbpl server logs -f` 可直接驗證 live request tail
- README / enduser SKILL / install.md 改成 `vbpl server start` 主軸;`bun run server|dev|start` 收斂為 maintainer source-workflow 備註
- `vbpl pipeline delete` cascade(phase8 t6):一條指令清 worktree dir + git branch + pipeline.json;running / queued state 拒絕(STATE_GUARD「先 stop」);`--force` 跳 confirm prompt
- `RunHistory` 加失敗原因 + ticket 進度 diff + codex 條件隱藏空欄(phase8 t5):runner exit 寫 `failureReason` / `ticketsBefore` / `ticketsAfter`;codex run 不顯成本/回合/Tokens(本來就無資料,避免「—」雜訊)
- Runner 主迴圈強制每輪重讀 pipeline.json(`b096cc8`):codex 主 agent 偷懶用 context cache 跳過 disk re-read,實測 user 跑中加 ticket 看不到 → 跑完自宣告完成。prompt 強硬語氣明標「絕對不准用 context tickets 記憶」
- `refactor` pipeline merge(`6118f02`):**CSS dead code 清理**(`src/styles + features/**/*.css` scope 鎖死,t1);**SW `/api/*` GET 改 `NetworkOnly`**(去 polling flicker,t2);activate handler `caches.delete("api-cache")` 清舊 cache;dist 651→636 KiB
- Audit log `user_action` 加 `via` 欄(`1526488`):cli / browser / other 三值;vbpl CLI fetch 自帶 `User-Agent: vbpl-cli`,backend `detectVia(req)` 讀 UA 寫 audit。debug 「mystery run」(audit 抓到但 user 沒按)時可秒判 source
- `vbpl` binary 統一放 `~/.vibe-pipeline/bin/vbpl.exe`(對齊 pyenv / cargo / nvm「per-tool dir」慣例);舊 `~/bin` / `/usr/local/bin` install path 從文檔 / PATH 拔
- `/acp`(add+commit+push)+ `/doc`(文件整理)slash commands 落地;`/acp` global,VP 慣例(中文 subject + Co-Authored-By 動態 model 名)
- Pipeline `019e3c96c5df-refactor`、`019e36fbea63-phase8`(全 6 ticket)merge 進 main
- **FCM push gateway MVP 落地**(`019e3d04e68a-fcm-gateway` t1-t5):maintainer host 集中 service account key,enduser 不必開 Firebase。Cloud Run asia-east1(`https://vp-gateway-799841449136.asia-east1.run.app`)+ Firestore per-token registry(multi-tenant)+ max-instances=1 service-level cap + $1/mo budget alert(abuse / runaway 雙保險)。gateway source 在 `gateway/`(~500 行 Bun service),admin CLI `vp-gw-admin` 發 / revoke / list token。設計 ref → [`refs/archive/fcm-push-gateway-2026-05-17.md`](refs/archive/fcm-push-gateway-2026-05-17.md)
- **Backend 拔 `firebase-admin`** 改 POST gateway(hard cutover,無 fallback):`server/lib/push/tokenStore.ts` 改成轉發 register / unregister;`server/lib/fcm/index.ts` `fanoutPush` 改 `fetch(gateway/push/send, Bearer token)`;沒填 `PUSH_GATEWAY_URL` / `PUSH_GATEWAY_TOKEN` 時 no-op(backend 啟動正常,只是不推)。enduser `.env.example` push 段精簡為 gateway URL + bearer token + 純 public Firebase Web SDK config
- 文件 / SKILL / rule 收尾:README 加 §Push 通知 setup 段;install.md 補 push 段;TODO #1 搬「已落地」;refs/README 對應移動;`.claude/rules/remote-access.md` push 段更新;backend SKILL Push subsection 重寫

---

## 2026-05-19(續,FCM gateway lazy onboarding)

**Push 通知 onboarding 從「3 step setup」拉到「零設定」**。enduser 不必跟 maintainer 拿 token、不必填任何 `.env` push var,開 PWA → Settings →「通知」啟用即用(pipeline `019e3f0fc842-fcm-gateway-lazy`,t1-t3)。

- **t1 / `4093766` Gateway 加 `POST /tokens/auto-issue`**(無 Bearer):IP `sha256` 雜湊後落 Firestore `tokenIssueRateLimits`(doc id `<ipHash>_day_<YYYYMMDD>`,limit 5/UTC day,`expiresAt` 48h auto-purge)。token 複用既有 `enduserTokens` collection,response `{tokenId, token}` 同 admin schema。label optional + 用 IP 後 4 碼 fallback(`auto-<hash4>`)。`gateway/README.md` + `INFRA.md` 補 endpoint 說明
- **t2 / `5357385` Backend lazy fetch**:新 `server/lib/push/gatewayToken.ts`(`getToken` / `ensureToken` / `clearToken`,SSOT `~/.vibe-pipeline/gateway-token`)。atomic `.tmp → rename` + posix `chmod 0600` + in-flight Promise 合併並發 register 避免雙申請;`PUSH_GATEWAY_TOKEN` env read-only override 給 forker / CI。`tokenStore.register/unregister` 進入點呼 `ensureToken`;`listTokens` 走被動 `getToken` 避免誤觸 issue。`fcm/index.ts` `fanoutPush` 改 `getToken`,沒 token → warn + return [] 不 throw。`.env.example` 刪 `PUSH_GATEWAY_TOKEN=`
- **t3 / `dce03cb` Hardcode defaults**:`src/lib/fcm.ts` 加 `DEFAULT_FCM_CONFIG`(maintainer 公開 Firebase Web SDK config 7 欄),`resolveConfig` 改 `VITE_FCM_*` env override default + 移除 `fetchConfig`(純前端 resolve)。`server/lib/fcm/index.ts` 加 `DEFAULT_GATEWAY_URL = https://vp-gateway-799841449136.asia-east1.run.app`,`PUSH_GATEWAY_URL` env 仍可 override。`.env.example` push 段必填行全砍,只留 forker override 註解
- 注意:backend `/api/push/config` route 失去前端 consumer 變 dead code(t3 範圍外不動),後續可清

## 2026-05-19(續,DX 收尾)

- **`vbpl ticket add` `--goal` / `--prompt` / `--acceptance` 全列必填**(`f5a5170`):之前只 `--title` 必填,user 手 craft ticket 容易漏 `--goal` 導致 web UI card 空一段 + commit log 少 context。改成 3 個都必填,沒帶 → INVALID_ARGS 友善報原因。QA drawer 流程不走 CLI 不受影響
- **`/dev/states` 視覺驗證頁全砍**(`be98ca4`):dev-only StatesGallery + e2e `dev-states.spec.ts` 共 -206 行。改 button 邏輯靠 TS exhaustive switch + 真實 board 驗即可,不必另開 fixture gallery
- **Production inline magic px → 0**(`8dad22e`):SettingsPopover `push-toggle-row` / QADrawer `qadr-iter-limit-input` / PickerSelect `picker-item-icon` 3 處改 CSS class,對齊 frontend SKILL inline policy
- **`/api/push/test` error 訊息對齊 gateway**(`653eeab`):從「檢查 FCM_SERVICE_ACCOUNT_PATH」(已廢 env)改「檢查 PUSH_GATEWAY_URL」

---

## 2026-05-20(自動更新落地)

**Enduser 不必離開 PWA 進 terminal 跑 `git pull`**,Settings 一鍵搞定 backend + UI 更新(pipeline `019e40b31763-auto-update`,t1-t4)。

- **t1 `/api/system/version`**:回當前 commit / branch / 是否髒,加 GitHub `releases/latest` 拉 latest release tag(unauthenticated public endpoint,有 cache 避免 rate limit);沒發 release → `latestRelease: null`
- **t2 `/api/system/update`**:POST 觸發 backend `git pull` → `bun install`(若 `package.json` deps / `bun.lock` 有變)→ `bun run build` → detach 新 process 自我重啟,舊 process exit;期間 API 短暫 503,Settings poll auto-retry
- **t3 Settings 第 4 tab「更新」**:顯版本 + 「檢查更新」/「套用更新」二鍵;沒新 release 時「套用更新」停用顯「已是最新」
- **t4 `SwUpdateBanner` button label rename**:「更新」→「**套用更新**」,對齊 Settings 同名按鈕。整條 flow:Settings 按「套用更新」走 backend(server 端 pull+build+restart)→ 新 bundle 由 Workbox 偵測 → SwUpdateBanner 跳「套用更新」(client 端 skipWaiting + reload),user 認知是同一動作的兩階段
- **版本來源 = GitHub release tag**(semver):maintainer `git tag vX.Y.Z && git push --tags`(GitHub 自動建 release entry,可走 Releases UI / `gh release create` 補 release notes),未發 release = enduser 看到「已是最新」
- **不在 scope**:`vbpl` CLI binary 自動更新(backend 重啟不會替換 PATH 上 `vbpl.exe`,要新 CLI feature 仍走手動 `bun run cli:build` + 蓋 `~/.vibe-pipeline/bin/vbpl.exe`);Settings 一鍵流程只動 backend + UI source / build artifact
- **文件**:`README.md` §自動更新、`docs/vibe-pipeline/install.md` §升級改成 Settings 一鍵主軸、`docs/vibe-pipeline/SKILL.md` 加自動更新段(enduser AI 引導 user 用 Settings tab)、`.claude/rules/pwa-sw.md` 補 SwUpdateBanner label 對齊 Settings update flow 說明

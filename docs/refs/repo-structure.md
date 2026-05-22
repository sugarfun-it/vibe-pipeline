# Repo 結構(物理路徑 single source of truth)

> **集中規則**:repo 物理檔案 / 目錄結構**只在本檔寫一份**。SKILL 內不再畫樹,只寫該層的「約定 / 職責邊界 / 思想」。新增資料夾或重組時改本檔,SKILL 自動跟著對。

## Repo 內

```
vibe-pipeline/
├── CLAUDE.md                  always-on 規則 + 雷區 + 設計信條(精簡)
├── AGENTS.md                  跨 provider pointer(codex 等不認 CLAUDE.md/skills 的 AI 看這份)
├── package.json               Bun + Vite + React + TS deps
├── bun.lock
├── tsconfig.json
├── vite.config.ts             dev server(host 0.0.0.0 + allowedHosts true + /api → :3001 proxy)
├── index.html                 Vite 入口,inline theme sync script + viewport-fit=cover + manifest link
├── .env / .env.example        FCM keys / ALLOWED_ORIGINS / VITE_API_BASE_URL(.env gitignored)
├── public/
│   ├── manifest.json          PWA manifest(name / icons / display:standalone / theme_color)
│   ├── firebase-messaging-sw.js  Service Worker(push event 自處理 + showNotification)
│   ├── icon.svg               SVG 主 icon(對齊 TopBar Logo)
│   └── icon-{192,512}.png     ImageMagick 從 SVG 產(`bun run scripts/gen-icons.ts`)
├── scripts/
│   ├── gen-icons.ts           SVG → PNG 工具腳本(需 ImageMagick)
│   ├── build-tarball.ts       maintainer 打 release tarball(嚴格白名單)
│   ├── install.sh             enduser POSIX installer(curl … | sh)
│   ├── install.ps1            enduser Windows installer(irm … | iex)
│   ├── uninstall.sh / .ps1    對稱 uninstaller(只移 app/ + shim,保留 state)
│
├── cli/                       vbpl CLI。約定見 vibe-pipeline-cli SKILL
│   ├── vbpl.ts                entry — parseArgs + dispatch noun → commands/*
│   ├── commands/{project,pipeline,ticket,config}.ts   noun × verb 實作
│   └── lib/{args,output,project}.ts                   參數解析 / 統一輸出 / project 解析
│   (透過 import server/lib/* 直接讀寫 fs,不發 HTTP;dev clone 入口:`bun run cli/vbpl.ts`;enduser 入口:`~/.vibe-pipeline/bin/vbpl[.cmd]` shim)
│
├── src/                       前端。約定見 vibe-pipeline-frontend SKILL
│   ├── App.tsx                router (BrowserRouter + Routes)
│   ├── main.tsx               React mount,import 全域 CSS (tokens/board/notif)
│   ├── shell/
│   │   ├── AppShell.tsx       slot-based shell (topBar/banner/rail/main/aside/overlay)
│   │   ├── EmptyShell.tsx     全屏自由排版 (Init 用)
│   │   ├── TopBar.tsx
│   │   └── Rail.tsx
│   ├── ui/                    跨 feature 通用基礎元件
│   │   ├── icons.tsx          ~20 個 icon + BannerIcon kind switch
│   │   ├── Logo.tsx
│   │   └── PickerSelect.tsx
│   ├── features/
│   │   ├── notifications/     NotificationsScreen + InboxColumn + NotifBanner
│   │   ├── pipeline/          BoardScreen + FocusColumn + EmptyProject + TicketDrawer + RunHistory + DiffModal
│   │   ├── pipelineCreate/    CreateCard + CreatePlaceholder
│   │   ├── init/              InitPopup (修改後直接接 BoardScreen)
│   │   ├── qa/                QADrawer + useQA (真接 backend)
│   │   ├── auth/              SetupScreen + LoginScreen + SecurityTab + AddDeviceDialog + useAuthStatus + authApi + types
│   │   ├── settings/          SettingsPopover + SettingsPopover.css(tab UI:Project / AI 任務 / 通知 / 安全)
│   ├── lib/
│   │   └── fcm.ts             Firebase 前端 SDK init + getToken + register + foreground handler
│   ├── styles/                CSS(tokens / board / notif / init / drawer / qa)
│   ├── data/                  純 helper(STATE_COLOR / SEV_COLOR / fmtElapsed),mock seed 已全砍
│   ├── types/                 過渡型別 (UI-only) — pipeline.ts / notif.ts
│   ├── api/                   每 endpoint 一個 fetchXxx() — projects.ts / qa.ts
│   ├── hooks/                 useActiveProject(URL ?project=hash + localStorage fallback)
│   └── router/                (規劃) buildPath helper
│
├── server/                    後端。職責邊界見 vibe-pipeline-backend SKILL
│   ├── index.ts               Bun.serve 入口,route 表 + authGuard middleware
│   ├── routes/                純 dispatch,不寫業務邏輯
│   │   ├── _http.ts           ok/err/requireJsonUtf8/readJson 共用 Response 包裝
│   │   ├── projects.ts        /api/projects/* (含 pipelines CRUD + git-init + reveal + 重置)
│   │   ├── qa.ts              /api/.../qa/* (start / turn / finalize / cancel / drafts)
│   │   ├── userConfig.ts      /api/user/config GET / PUT(跨 project per-task-class model)
│   │   ├── auth.ts            /api/auth/{status,setup-init,setup-verify,login,logout,sessions,reset}
│   │   ├── push.ts            /api/push/{config,register,unregister,tokens,test}
│   │   ├── system.ts          /api/system/{version,update}(self-update tarball flow)
│   │   └── test.ts            test-mode only endpoint
│   └── lib/                   純 IO + 邏輯,不知道 HTTP
│       ├── projectStore.ts    ~/.vibe-pipeline/state.json 讀寫(toProject 純 fs 不呼 git)
│       ├── pipelineDir.ts     <target-repo>/.vibe-pipeline/ 偵測 / 建立 / json 讀寫
│       ├── hash.ts            absolute path → 8-char sha256
│       ├── paths.ts           ~/.vibe-pipeline 等 path 集中
│       ├── dialog.ts          OS native folder picker (osascript/powershell/zenity) + revealFolder
│       ├── userConfig.ts      ~/.vibe-pipeline/config.json
│       ├── git.ts             hasGit / gitInit
│       ├── fs.ts              isExistingDirectory 等小 fs helper
│       ├── jsonFile.ts        legacy json 讀寫 helper(新 code 走 atomicWrite)
│       ├── spawn.ts           runCapture / spawnStreaming / spawnFireForget(default windowsHide)
│       ├── atomicWrite.ts     atomicWriteJson / atomicWriteText(Win EPERM retry + chmod + JSON validate)
│       ├── jsonl.ts           readJsonl<T> / appendJsonl<T>(audit log + notifs 用)
│       ├── auditLog.ts        user_action / system 事件 append .runtime/audit.jsonl
│       ├── systemVersion.ts   GitHub releases/latest 拉 + git HEAD diff(/api/system/version 用)
│       ├── updater.ts         tarball self-update(performUpdate + spawnNewBackend)
│       ├── testMode.ts        E2E / 測試 flag 中央開關
│       ├── depInstall.ts      merge 後動 deps → 自動 bun install(見 CLAUDE.md §self-dogfood 加 npm dep)
│       ├── pipelineMerge.ts   mechanical(git --no-ff)+ AI fallback merge
│       ├── git/worktree.ts    ensure / remove / prune (per pipeline)
│       ├── cli/               CliAdapter + claudeAdapter + codexAdapter + factory(prompt 走 stdin + workerEnv)
│       ├── auth/              storage / middleware / cookie / pending
│       ├── push/              tokenStore(轉 gateway HTTP) + gatewayToken(lazy auto-issue + SSOT ~/.vibe-pipeline/gateway-token)
│       ├── fcm/index.ts       fanoutPush 走 maintainer-host gateway(無 firebase-admin)
│       ├── runner/            orchestrator(killProcessTree 跨平台) / ticketWatcher / runnerPrompt / runLog / syncJob
│       ├── notifs/store.ts    emit / list / markRead / dismiss → .runtime/notifs.jsonl
│       └── qa/                claudeCli / draftStore / systemPrompt / splitTicket / schema
│
├── shared/
│   └── types.ts               跨 backend/frontend 持久化型別
│
├── gateway/                   FCM push gateway(Cloud Run service,2026-05-19 落地)
│   ├── index.ts               Bun.serve entry,7 endpoint(/health + push/{register,send,unregister} + admin/{issue,revoke,tokens} + tokens/auto-issue)
│   ├── admin.ts               vp-gw-admin CLI(maintainer issue/revoke/list token,master Bearer)
│   ├── Dockerfile             oven/bun:1 base,Cloud Run 用
│   ├── INFRA.md               GCP infra setup 紀錄(project / SA / Firestore / Cloud Run URL)
│   ├── deploy.md              gcloud run deploy 指令 + rollback / troubleshoot
│   ├── README.md              service 結構 + local dev + curl 範例 + admin CLI 用法
│   └── lib/                   firestore / fcm / auth / tokens / rateLimit 拆分
│
├── design/                    Claude Design handoff bundle(歷史紀錄,real code 已不引用)
│
├── docs/
│   ├── CHANGELOG.md           歷次大改動
│   ├── TODO.md                待動工清單(對應 phase 8 pipeline)
│   ├── release/v<ver>.md      GitHub release notes(maintainer 寫,build-tarball.ts 不打包進 tarball)
│   ├── refs/                  設計文件 / 競品對照 / 歷史 spec(maintainer 用)
│   │   ├── README.md          refs 目錄索引(active / archive)
│   │   ├── repo-structure.md  本檔
│   │   └── enduser-install-update-design.md   tarball install + update 設計(v3,obsolete;檔頂有 banner 指向 backend SKILL §Self-update)
│   └── vibe-pipeline/         enduser AI bundle(distributable)
│       ├── SKILL.md
│       ├── install.md
│       └── repl-runner.md
│
├── .claude/
│   ├── skills/                repo 內 maintainer SKILL
│   │   ├── vibe-pipeline-frontend/SKILL.md
│   │   ├── vibe-pipeline-backend/SKILL.md
│   │   ├── vibe-pipeline-cli/SKILL.md
│   │   └── vibe-pipeline-e2e/SKILL.md
│   └── rules/                 path-specific 雷區(frontmatter `paths:` 標明適用範圍)
│       ├── pwa-sw.md          SW / Workbox / vite-plugin-pwa
│       ├── remote-access.md   Tailscale / TOTP / FCM / network binding
│       └── cli-codex.md       codex CLI spawn / sandbox / multi-agent
│
└── node_modules/              (gitignored)
```

## Repo 外(runtime data)

```
~/.vibe-pipeline/              global runtime,跨 project 共用(在 user home)
├── app/                       enduser install dir(install.sh / install.ps1 解 tarball 進來;dev clone 無此)
├── app.download.tmp/          updater 下載 / 解壓 staging(performUpdate 用完即清)
├── bin/vbpl[.exe]             CLI binary install path(對齊 pyenv/cargo/nvm 慣例)
├── state.json                 { lastProject, recentProjects: [{path, lastOpenedAt}] }
├── config.json                user-level model defaults(per-task-class)
├── auth.json                  TOTP secret 雜湊 + sessions[]
├── gateway-token              FCM gateway bearer token(lazy auto-issue,posix 0600)
├── server.json                vbpl server start 記 vibe-pipeline repo path / PID / log path
├── server.log                 vbpl server start 接的 backend stdout/stderr
├── update.log                 self-update flow log(truncate per run)
└── worktrees/<projHash>/<pipelineId>/   git worktree per pipeline,平行執行用

舊 `device_tokens.json` 已不寫(2026-05-19 push gateway 接管,device token 全在 gateway Firestore)。

<target-repo>/.vibe-pipeline/  每個 user target repo 內,由 init 建(整 dir gitignored)
├── config.json                project-local 設定(不隨 repo 共享,team 各自 init)
├── pipelines/*.json           一檔一條,內含 tickets 陣列
└── .runtime/
    ├── qa-drafts/<id>.json    QA 對話 draft (含 session_id)
    ├── notifs.jsonl           backend emit 事件流(append-only)
    └── logs/<pipelineId>-<ts>.log  runner 主 agent stdout/stderr
```

`<target-repo>/.vibe-pipeline/` **不在這個 repo 內**(除非 self-dogfood),是 VP 操作的 target repo 才有。跟 user home 的 `~/.vibe-pipeline/`(global state)同名但位置不同,程式上不撞。

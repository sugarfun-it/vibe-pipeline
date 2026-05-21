# Install `vbpl` CLI

Enduser 安裝手冊。README 的 §安裝 (enduser) 是 landing 簡介,本檔詳細。

## 系統需求

- [Bun](https://bun.sh) ≥ 1.1(install script 第一步會 check,沒裝會提示)
- Git(只在 dev clone 模式需要)
- Windows 10+ / macOS 11+ / Linux

## 安裝(一行)

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.sh | sh
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.ps1 | iex
```

Script 流程:
1. Bun check(沒裝報錯停)
2. 抓 GitHub latest release
3. 下載 `.tar.gz`(~823 KB,內含預裝 node_modules)
4. 解壓到 `~/.vibe-pipeline/versions/v0.X.Y/`
5. 建 junction/symlink `~/.vibe-pipeline/current → versions/v0.X.Y/`
6. 寫 shim `~/.vibe-pipeline/bin/vbpl[.cmd]`(99 bytes,內含 `bun run current/cli/vbpl.ts %*`)
7. 互動式問是否加 `~/.vibe-pipeline/bin/` 到 PATH(默認 N)
8. 提示「Run `vbpl server start`」(POSIX `--auto-start` flag 會自動起;Windows 因 stdio chain bug 不自動起,要 user 自己跑)

裝完開新 terminal:
```
vbpl --version    # vbpl 0.X.Y
vbpl server start # 起 backend on 3001(同 serve API + PWA)
```

然後打開 <http://localhost:3001/>(或 Tailscale URL)看 PWA。

## Layout

```
~/.vibe-pipeline/
├── versions/v0.X.Y/    各版本獨立 dir(stripped package.json + 預裝 node_modules)
├── current → ...       junction(Win)/ symlink(POSIX),指當前版本
├── bin/vbpl[.cmd]      shim(99 bytes,跨版本穩定,不被 update 動)
├── scripts/            install / uninstall / update scripts(從 tarball 帶來)
├── state.json          recent projects 等 global state
├── config.json         user-level model defaults
├── auth.json           TOTP secret + sessions
├── gateway-token       FCM gateway bearer
├── server.json         vbpl server start 管理檔
├── server.log          backend stdout/stderr
└── worktrees/          per-pipeline git worktree
```

## 升級

任一條:

```bash
vbpl update              # CLI(任一平台)
# 或
# PWA Settings → 更新 → 「套用更新」按鈕(一鍵,沒 terminal 也行)
# 或重 install:
irm https://.../install.ps1 | iex
curl -fsSL https://.../install.sh | sh
```

3 條共用同一 install script(`scripts/install.{ps1,sh}`),single source of truth。流程:stop backend → download new tarball → swap `current` junction → install bun deps → start new backend。整套 ~5-30 秒(含 Windows cold start)。

PWA 端 `<SwUpdateBanner>` 偵測新 UI bundle hash → 跳「套用更新」按下 reload 新 UI。

## 解除安裝

```sh
# POSIX
curl -fsSL https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/uninstall.sh | sh

# Windows
irm https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/uninstall.ps1 | iex
```

只移除 `~/.vibe-pipeline/{versions,current,bin}/`;state / auth / worktrees / config 保留。完全清:

```sh
rm -rf ~/.vibe-pipeline
```

## Push 通知 setup(零設定)

手機 PWA Settings →「通知」開 toggle 即可,**沒有任何 env 要設**。Firebase Web SDK config + gateway URL hardcode 進 build,backend 首次 register 時自動向 gateway 申請 token 存 `~/.vibe-pipeline/gateway-token`。

要自架 gateway / override 預設 → 設 `PUSH_GATEWAY_URL` / `PUSH_GATEWAY_TOKEN`(backend)、`VITE_FCM_*`(frontend build)。背景跟自架說明見 [`gateway/README.md`](../../gateway/README.md) + [`docs/refs/archive/fcm-push-gateway-2026-05-17.md`](../refs/archive/fcm-push-gateway-2026-05-17.md)。

## Trouble

| 症狀 | 解 |
|---|---|
| `vbpl: command not found` | install script 結尾沒選加 PATH → 開新 terminal + `~/.vibe-pipeline/bin` 加進 PATH(POSIX 改 `.zshrc`/`.bashrc` / Windows 改 user PATH env) |
| Bun not installed | 跑 `curl -fsSL https://bun.sh/install \| bash`(POSIX)或 `irm bun.sh/install.ps1 \| iex`(Windows) |
| PWA「套用更新」按下後卡住 | 看 `~/.vibe-pipeline/update.log`,常見:port 3001 zombie(等 ~2 min 或 reboot) |
| 多版本衝突 | `which vbpl`(POSIX)/ `where.exe vbpl`(Windows)看實際路徑,清舊版 |

## Maintainer:發 release

```bash
# 1. bump version
# package.json "version": "0.X.Y"

# 2. 寫 release notes(optional)
# docs/release/v0.X.Y.md

# 3. 打 tarball(嚴格白名單 + strip + 預裝 node_modules)
bun run scripts/build-tarball.ts v0.X.Y

# 4. tag + push
git tag v0.X.Y && git push --tags

# 5. 發 release
gh release create v0.X.Y --notes-file docs/release/v0.X.Y.md vibe-pipeline-v0.X.Y.tar.gz
```

Tarball 白名單見 `scripts/build-tarball.ts`(`WHITELIST` 常數)。新 server 子目錄要進 tarball **必須改該 array**,否則 enduser 收到的 tarball 缺檔。

## Dev clone(maintainer)

不必走 install script。直接:

```bash
git clone https://github.com/eric14304/vibe-pipeline
cd vibe-pipeline
bun install
bun run dev        # vite HMR 5173 + backend 3001(SW 不註冊,純 dev workflow)
# 或
bun run start      # production build + backend(同 serve API + dist/ PWA 在 3001)
```

CLI 從 dev clone:
```bash
bun run cli/vbpl.ts <noun> <verb>     # 直接從 source
# 或
bun run vbpl <noun> <verb>            # 同 script alias
```

Dev 不必裝 enduser shim — 從 dev clone source 直接跑就行。

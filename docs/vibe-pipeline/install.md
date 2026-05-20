# Install `vbpl` CLI

完整安裝手冊。README 的 §CLI 是 landing 簡介,本檔是 single source of truth。

## Build binary

```bash
bun run cli:build           # Windows x64           → dist-cli/vbpl.exe
bun run cli:build:mac       # macOS arm64 (Apple)   → dist-cli/vbpl-mac
bun run cli:build:mac-x64   # macOS x64 (Intel)     → dist-cli/vbpl-mac-x64
bun run cli:build:linux     # Linux x64             → dist-cli/vbpl-linux
```

binary ~121 MB(bundle 整個 Bun runtime)。

## Start backend(enduser / AI flow)

安裝到 PATH 後,日常跑 pipeline 不需要進 vibe-pipeline repo 起 `bun run server`。用 `vbpl server` 管 backend:

```bash
vbpl server start
vbpl server status
vbpl server logs -f          # 需要 debug 時
vbpl server restart
vbpl server stop
```

`vbpl server start` 會從當前目錄、`VBPL_HOME` 或既有 `~/.vibe-pipeline/server.json` 自動找到 vibe-pipeline repo,用背景 process 啟動 backend(3001)。`vbpl pipeline run|stop|merge|sync` 也會 auto-detect + auto-start local backend;失敗時看 `vbpl server logs`。

Maintainer 改 vibe-pipeline source code 才用 `bun run server` / `bun run dev` / `bun run start`。

## Install to PATH(per OS)

VP 所有 artifact 統一收 `~/.vibe-pipeline/`(binary / config / runtime data / worktrees 都在這 dir)。binary 進 `~/.vibe-pipeline/bin/`,對齊 pyenv / cargo / nvm 慣例。

### macOS (Apple Silicon, arm64)

```bash
bun run cli:build:mac
mkdir -p ~/.vibe-pipeline/bin
cp dist-cli/vbpl-mac ~/.vibe-pipeline/bin/vbpl
chmod +x ~/.vibe-pipeline/bin/vbpl
echo 'export PATH="$HOME/.vibe-pipeline/bin:$PATH"' >> ~/.zshrc    # bash 用 .bashrc
source ~/.zshrc
vbpl --version                                        # 驗
```

### macOS (Intel, x64)

```bash
bun run cli:build:mac-x64
mkdir -p ~/.vibe-pipeline/bin
cp dist-cli/vbpl-mac-x64 ~/.vibe-pipeline/bin/vbpl
chmod +x ~/.vibe-pipeline/bin/vbpl
echo 'export PATH="$HOME/.vibe-pipeline/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
vbpl --version
```

### Linux (x64)

```bash
bun run cli:build:linux
mkdir -p ~/.vibe-pipeline/bin
cp dist-cli/vbpl-linux ~/.vibe-pipeline/bin/vbpl
chmod +x ~/.vibe-pipeline/bin/vbpl
echo 'export PATH="$HOME/.vibe-pipeline/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
vbpl --version
```

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "$HOME\.vibe-pipeline\bin"
Copy-Item dist-cli\vbpl.exe "$HOME\.vibe-pipeline\bin\vbpl.exe"
$user = [Environment]::GetEnvironmentVariable("Path", "User")
if ($user -notmatch [Regex]::Escape("$HOME\.vibe-pipeline\bin")) {
  [Environment]::SetEnvironmentVariable("Path", "$HOME\.vibe-pipeline\bin;$user", "User")
}
# 開新 terminal 驗:vbpl --version
```

### Windows Git Bash

PATH 繼承 Windows user PATH(上面 PowerShell 設一次,Git Bash 也吃),不必另設。或:

```bash
mkdir -p ~/.vibe-pipeline/bin && cp dist-cli/vbpl.exe ~/.vibe-pipeline/bin/
echo 'export PATH="$HOME/.vibe-pipeline/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 升級

**Backend / Web UI**:不必再手動 `git pull`。開 PWA → **Settings →「更新」tab** 看版本,點「檢查更新」拉 GitHub latest release,點「套用更新」一鍵 backend `git pull` + `bun install`(若 dep 變)+ `bun run build` + 自我重啟;完成後 `<SwUpdateBanner>` 跳「套用更新」按下去 reload 套新 UI。詳見 [`../../README.md`](../../README.md) §自動更新。

**`vbpl` CLI binary**:單檔 binary 自動更新不在 scope(backend 重啟不會替換 PATH 上的 `vbpl.exe`),要新 CLI feature 仍用:

```bash
cd <vibe-pipeline-repo>
git pull                                                  # 或直接靠 Settings 一鍵更新拉好的 source
bun run cli:build                                         # 出 dist-cli/vbpl.exe
cp dist-cli/vbpl.exe ~/.vibe-pipeline/bin/vbpl.exe        # 蓋掉舊版,PATH 不必動
```

只更 backend / UI(沒新 CLI feature)只用 Settings 一鍵流程即可,不需碰 binary。

## Push 通知 setup(零設定)

手機 PWA Settings →「通知」開 toggle 即可,**沒有任何 env 要設**。Firebase Web SDK config + gateway URL hardcode 進 build,backend 首次 register 時自動向 gateway 申請 token 並存 `~/.vibe-pipeline/gateway-token`。

要自架 gateway / override 預設 → 設 `PUSH_GATEWAY_URL` / `PUSH_GATEWAY_TOKEN`(backend)、`VITE_FCM_*`(frontend build 時)。背景跟自架說明見 [`gateway/README.md`](../../gateway/README.md) 與 [`docs/refs/archive/fcm-push-gateway-2026-05-17.md`](../refs/archive/fcm-push-gateway-2026-05-17.md)。

## Trouble

| 症狀 | 解 |
|---|---|
| `command not found` 在新 terminal | PATH 沒生效 → 開新 terminal session 或 source rc |
| Windows `vbpl` 找不到但 `vbpl.exe` 找得到 | PowerShell PATHEXT 沒含 → 顯式打 `vbpl.exe` 或加 `.EXE` 到 PATHEXT |
| macOS Gatekeeper 警告(下載 binary 而非自己 build)| `xattr -d com.apple.quarantine ~/bin/vbpl` |
| 多版本衝突 | `which vbpl`(macOS/Linux)/ `where.exe vbpl`(Windows)看實際路徑,清舊版 |

## 散發 binary 給其他人

`dist-cli/` 已 gitignore。build 完把 binary 複製給對方,讓對方按上方 §Install to PATH 流程安裝即可。

跨 build target 看 [Bun build --compile docs](https://bun.sh/docs/bundler/executables) 的 `--target=bun-windows-x64-baseline` 等 baseline 變體(產出更小,但需 CPU 支援檢查)。

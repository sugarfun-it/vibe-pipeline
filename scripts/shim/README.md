# vbpl Windows shim(Rust)

取代 `vbpl.cmd`,解 Windows `.cmd` shim 一整包雷(spawn 解析 / cmd.exe re-tokenize /
PATHEXT 大小寫 / 啟動 overhead / signal 傳遞 / stdio TTY / process tree),不動 self-update
邏輯、不動 enduser bun 依賴(仍要 bun.exe on PATH)。

## Build

需要 Rust toolchain(`rustup`):

```bash
cd scripts/shim
cargo build --release
# 產出:scripts/shim/target/release/vbpl.exe
```

第一次 build 慢(rustc 初始化 + 依賴),~30s。之後 incremental 秒級。
release 模式 + `strip = true` + `opt-level = "z"` + `panic = "abort"` → exe 大小 ~ 200-400 KB。

## Cross-compile from POSIX(optional)

```bash
rustup target add x86_64-pc-windows-gnu
cd scripts/shim
cargo build --release --target x86_64-pc-windows-gnu
# 產出:scripts/shim/target/x86_64-pc-windows-gnu/release/vbpl.exe
```

需要 mingw-w64(`apt install mingw-w64` / `brew install mingw-w64`)。

## 手動驗證(不動 install pipeline)

```powershell
# 1. build 出 vbpl.exe(假設已 cargo build --release)
# 2. 備份現有 vbpl.cmd,放新 exe 進去
$shim = "$HOME\.vibe-pipeline\bin\vbpl.exe"
Move-Item "$HOME\.vibe-pipeline\bin\vbpl.cmd" "$HOME\.vibe-pipeline\bin\vbpl.cmd.bak" -Force
Copy-Item scripts/shim/target/release/vbpl.exe $shim

# 3. 開新 PowerShell(讓 PATH 重新解析).cmd → .exe
vbpl --version
vbpl server status

# 4. Node spawn 測 ── 之前 .cmd 撞 ENOENT,新 exe 該過
bun -e "const r = Bun.spawnSync(['vbpl', '--version']); console.log('exit:', r.exitCode);"

# 5. Ctrl+C 測 ── vbpl server logs -f 後按 Ctrl+C,子程序該乾淨 exit
```

驗 OK 後再考慮整合進 `scripts/install.ps1`(把 `vbpl.cmd` 換成 `vbpl.exe`)、`scripts/build-tarball.ts`(把 shim 加進 tarball)、release pipeline cross-compile。

## Signal 行為

Windows 不走 POSIX signal,console event(Ctrl+C / Ctrl+Break)由系統廣播給 console group
內所有 process。Bun child 因 stdio inherit 跟 shim 同 console group → 自動收到 → 自行
shutdown。**shim 完全不必 forward signal**。

例外:`taskkill /F /PID <shim-pid>` 不發 console event 直接強殺 → child 可能 orphan。
若 enduser 要乾淨 cleanup,改用 `taskkill /T /F`(tree kill)。

## 不簽名的 SmartScreen

未簽名 exe 首次跑 Windows 會跳「Windows protected your PC」紅框 → user 按「更多資訊」→
「仍要執行」才能跑。reputation 累積後變較弱「不明發行者」黃框。

正式發布前考慮 Azure Trusted Signing($10/mo,無硬體 token)或 EV Code Sign(~$300/yr)。
個人 / 小團隊用 Azure Trusted Signing 較合理。

# vbpl Windows shim(Rust)

取代 `vbpl.cmd`,解 Windows `.cmd` shim 一整包雷(spawn 解析 / cmd.exe re-tokenize /
PATHEXT 大小寫 / 啟動 overhead / signal 傳遞 / stdio TTY / process tree),不動 self-update
邏輯、不動 enduser bun 依賴(仍要 bun.exe on PATH)。

## Build

需要 Rust toolchain(`rustup`)+ mingw linker。`rust-toolchain.toml` 跟 `.cargo/config.toml`
固定 target = `x86_64-pc-windows-gnu`,第一次 build 自動 install 對應 std。

```bash
cd scripts/shim
cargo build --release
# 產出:scripts/shim/target/x86_64-pc-windows-gnu/release/vbpl.exe
```

第一次 build 慢(rustc 初始化 + std download + 依賴),~30s。之後 incremental 秒級。
release 模式 + `strip = true` + `opt-level = "z"` + `panic = "abort"` → exe 大小 ~ 320 KB。

### linker 要求(per platform)

| OS | 需要 | 怎麼裝 |
|---|---|---|
| Windows | mingw-w64 `gcc.exe` on PATH | `winget install MSYS2.MSYS2` + `pacman -S mingw-w64-x86_64-gcc`,把 `C:\msys64\mingw64\bin` 加 PATH |
| Linux | `x86_64-w64-mingw32-gcc` on PATH | `apt install mingw-w64`(Debian / Ubuntu) |
| macOS | `x86_64-w64-mingw32-gcc` on PATH | `brew install mingw-w64` |

`scripts/build-tarball.ts` 在 Windows 會自動把 `C:\msys64\mingw64\bin` 跟 `~/.cargo/bin`
prepend 進 env,maintainer 不必每次手動改 PATH。

## 整合狀態

- ✅ `scripts/build-tarball.ts` 自動 build 並塞 `vbpl.exe` 到 tarball 的 `bin/vbpl.exe`
- ✅ `scripts/install.ps1` 優先用 tarball 內 `bin/vbpl.exe`,fallback 寫 `vbpl.cmd`(舊 tarball 相容)
- 未做:GitHub Actions Windows runner 跑 release build / Azure Trusted Signing 簽 exe

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

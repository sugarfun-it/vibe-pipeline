// vbpl Windows shim — 取代 .cmd 走 native exe,解 8 個 .cmd 雷:
// 1. spawn('vbpl') 從 Node/Bun 不再 ENOENT — .exe 直接被 libuv uv_spawn 認
// 2. cmd.exe re-tokenize 雷消失 — 沒中介 interpreter
// 3. PATHEXT 大小寫敏感不再相關 — Bun child 由 Rust Command 起,Win32 CreateProcess
//    走原生 PATH search,不靠呼叫端的 env Path/PATHEXT
// 4. Signal:console events(Ctrl+C / Ctrl+Break)由 Windows 自動派給 console group 內
//    所有 process,Bun child 直接收到,shim 不必特別 forward
// 5. 啟動 overhead:Rust release exe < 1ms 啟動,比 cmd.exe 10-50ms 快
// 6. Stdio TTY:Rust Command 預設 inherit handles,isatty 訊息正確傳遞給 Bun
// 7. Process tree:shim → bun.exe(2 層),沒 cmd.exe 中介(原 3 層)
// 8. cross-platform parity:POSIX 仍走 bash shim(scripts/install.sh 內),本檔只負責 Windows
//
// 安裝位置慣例:
//   %USERPROFILE%\.vibe-pipeline\bin\vbpl.exe       ← 本 shim
//   %USERPROFILE%\.vibe-pipeline\current\cli\vbpl.ts ← Bun 真實 entry
//
// shim 從 self 路徑推 install root,不需 embed 絕對路徑、不需 sibling .shim 檔。

use std::env;
use std::process::Command;

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let exe = match env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("vbpl: failed to resolve self path: {e}");
            return 2;
        }
    };
    // exe 在 <install_root>/bin/vbpl.exe — 推導 <install_root>/current/cli/vbpl.ts
    let install_root = exe
        .parent()
        .and_then(|p| p.parent())
        .expect("exe path must have grandparent");
    let vbpl_home = install_root.join("current");
    let cli_ts = vbpl_home.join("cli").join("vbpl.ts");

    if !cli_ts.exists() {
        eprintln!("vbpl: CLI script not found at {}", cli_ts.display());
        eprintln!("hint: expected install layout at {}", vbpl_home.display());
        return 2;
    }

    let args: Vec<String> = env::args().skip(1).collect();

    // 用 "bun.exe" 而非 "bun":Rust Command 在 Windows 雖會做 PATHEXT 走查,但顯式 .exe
    // 跳過 .com / .bat / .ps1 等較早的 PATHEXT entry,確保撞到 bun 而非同名 wrapper。
    let status = Command::new("bun.exe")
        .arg("run")
        .arg(&cli_ts)
        .args(&args)
        .env("VBPL_HOME", &vbpl_home)
        .status();

    match status {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("vbpl: failed to spawn bun.exe: {e}");
            eprintln!("hint: install Bun from https://bun.sh and ensure it's on PATH");
            127
        }
    }
}

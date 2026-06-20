// Port 自癒:backend bind DESIRED_PORT 撞 EADDRINUSE 時,元凶通常是「上一個 backend spawn 的
// sub-agent → vite/proto preview server 繼承了 listening socket handle 又沒隨 backend 一起死」
// (Windows child 預設繼承 inheritable handles;Bun 不開放關 socket 繼承旗標 → JS 層擋不掉)。
// 那些殘留 preview server 全在 .vibe-pipeline/worktrees/ 底下,殺掉就釋放被繼承的 socket → port 回收。
//
// 安全邊界:只殺 cmdline 命中 `.vibe-pipeline[/\]worktrees` 的 node/bun —— 絕不碰 target repo
// 自己的 dev server(那些路徑不在 worktrees 下)。startup 時沒有 pipeline 在跑(recoverStale 標 paused),
// 命中的必是孤兒,殺之安全。

import { spawnSync } from "node:child_process";

const IS_WIN = process.platform === "win32";
const WORKTREE_MATCH = "\\.vibe-pipeline[\\\\/]+worktrees";

// 殺掉所有 .vibe-pipeline/worktrees 下的孤兒 node/bun preview server。best-effort,吞錯。
// 回傳嘗試殺掉的 process 數(0 = 沒找到)。
export function killOrphanWorktreePreviews(): number {
  try {
    if (IS_WIN) return killWin();
    return killPosix();
  } catch {
    return 0;
  }
}

function killWin(): number {
  // 一次 PowerShell:找 node/bun 且 cmdline 命中 worktrees → Stop-Process -Force。輸出殺掉的數量。
  const ps =
    "$ErrorActionPreference='SilentlyContinue';" +
    "$ps=Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='bun.exe'\" |" +
    " Where-Object { $_.CommandLine -match '" +
    WORKTREE_MATCH +
    "' };" +
    "$n=0; foreach($p in $ps){ try{ Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $n++ }catch{} };" +
    "Write-Output $n";
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { encoding: "utf8", windowsHide: true, timeout: 15000 }
  );
  const n = parseInt((r.stdout ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function killPosix(): number {
  // pgrep -f 拿 pid,逐個 SIGKILL。pkill -f 也行但拿不到數量。
  const r = spawnSync("pgrep", ["-f", "\\.vibe-pipeline/worktrees"], { encoding: "utf8", timeout: 10000 });
  if (r.status !== 0 || !r.stdout) return 0;
  const pids = r.stdout
    .split(/\s+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n !== process.pid);
  let killed = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      killed++;
    } catch {
      // already gone / no perm
    }
  }
  return killed;
}

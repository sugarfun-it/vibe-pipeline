// 集中化 Bun.spawn 三個用途。所有 spawn 預設 windowsHide:true,避免散落各檔漏設視窗 leak。
//
// runCapture     — 純捕 stdout/stderr,await exited;最常見的「跑完拿輸出」型。
// spawnStreaming — 拿 handle(runner main agent 用,要 .stdin / .exited / .kill / 長跑 stream)。
// spawnGuiFireForget — dialog open / explorer reveal,不關心結果(GUI launcher,不掛 windowsHide)。
//
// Windows 雷:`detached: true` 跟 `windowsHide: true` 並用時,Win32 API silently ignore
// CREATE_NO_WINDOW(rprichard/win32-console-docs)→ child 可能 AllocConsole 起新 console
// → console window 閃。Windows 端 detached 沒實際好處(沒 process group 語意,killProcessTree
// 走 taskkill /T 不靠 detached)。所以 Windows 一律拿掉 detached,讓 windowsHide 真生效。

export type RunCaptureResult = {
  ok: boolean;
  out: string;
  err: string;
  exitCode: number | null;
};

export async function runCapture(
  args: string[],
  opts?: { cwd?: string; stdin?: string }
): Promise<RunCaptureResult> {
  try {
    const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
      cwd: opts?.cwd,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    };
    if (typeof opts?.stdin === "string") spawnOpts.stdin = "pipe";
    const proc = Bun.spawn(args, spawnOpts);
    if (typeof opts?.stdin === "string" && proc.stdin) {
      const sink = proc.stdin as { write: (s: string) => unknown; end: () => unknown };
      sink.write(opts.stdin);
      sink.end();
    }
    const [out, err, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      proc.exited,
    ]);
    return {
      ok: exitCode === 0,
      out,
      err,
      exitCode: typeof exitCode === "number" ? exitCode : null,
    };
  } catch (e) {
    return { ok: false, out: "", err: String(e), exitCode: null };
  }
}

// streaming spawn:caller 完全控制 lifecycle(.stdin / .exited / .kill / for-await stdout)。
// windowsHide 預設 true(可被 opts override,實務上不需要)。
// detached 預設:POSIX = true(child 進自己 process group,killProcessTree `process.kill(-pid)`
// 才能整棵殺到 sub-agent,macOS 雷 1);Windows = false(detached 會 silently 廢掉 windowsHide
// → 跑 pipeline 時 console window 閃,實測撞到。Windows 沒 process group 語意,killProcessTree
// 走 taskkill /T 不靠 detached)。注意:我們 await proc.exited,不呼 child.unref(),detached
// 純粹只為 POSIX process group。
// 回傳型別 generic 化保留 caller 的具體型(e.g. PipedSubprocess);內部用 unknown 過 type narrowing。
const IS_WIN = process.platform === "win32";

export function spawnStreaming<T extends Bun.Subprocess = Bun.PipedSubprocess>(
  args: string[],
  opts?: Partial<Parameters<typeof Bun.spawn>[1]>
): T {
  const merged = {
    windowsHide: true,
    ...(IS_WIN ? {} : { detached: true }),
    ...(opts ?? {}),
  } as Parameters<typeof Bun.spawn>[1];
  return Bun.spawn(args, merged) as unknown as T;
}

// GUI 變體:explorer / open / xdg-open 等 launcher。Bun.spawn 在 Windows 起 explorer 時
// 設 windowsHide: true 會讓 GUI window 不彈出來(現象:user 點「開啟 worktree」沒反應),
// 所以這條 path 不掛 windowsHide。stdout / stderr 仍 ignore。
export function spawnGuiFireForget(args: string[]): void {
  try {
    Bun.spawn(args, {
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    // ignore
  }
}

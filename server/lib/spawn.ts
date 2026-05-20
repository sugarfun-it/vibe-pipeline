// 集中化 Bun.spawn 三個用途。所有 spawn 預設 windowsHide:true,避免散落各檔漏設視窗 leak。
//
// runCapture     — 純捕 stdout/stderr,await exited;最常見的「跑完拿輸出」型。
// spawnStreaming — 拿 handle(runner main agent 用,要 .stdin / .exited / .kill / 長跑 stream)。
// spawnFireForget — dialog open / explorer reveal,不關心結果。

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
// detached 預設 true:POSIX 上 child 進自己 process group,killProcessTree 的 `process.kill(-pid)`
// 才能整棵殺到 sub-agent(macOS 雷 1)。Windows 無此語意,設了無害。注意:我們 await proc.exited,
// 不呼 child.unref(),detached 純粹只為 process group。
// 回傳型別 generic 化保留 caller 的具體型(e.g. PipedSubprocess);內部用 unknown 過 type narrowing。
export function spawnStreaming<T extends Bun.Subprocess = Bun.PipedSubprocess>(
  args: string[],
  opts?: Partial<Parameters<typeof Bun.spawn>[1]>
): T {
  const merged = {
    windowsHide: true,
    detached: true,
    ...(opts ?? {}),
  } as Parameters<typeof Bun.spawn>[1];
  return Bun.spawn(args, merged) as unknown as T;
}

// fire-and-forget:不 await,不關心結果。dialog reveal / open / xdg-open 用。
export function spawnFireForget(args: string[]): void {
  try {
    Bun.spawn(args, {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    });
  } catch {
    // ignore
  }
}

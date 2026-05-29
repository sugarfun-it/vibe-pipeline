import { watch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";

// 共用 tail-follow 骨架(watcher + debounce + drain + readIncremental + SIGINT)。
// followServerLog / followPipelineLog 兩處原本逐行重複,抽這裡共用。
//
// 各 caller 留兩個 hook:
//   resolveLogPath() — 回初始要 follow 的檔(server: 靜態路徑;pipeline: 等到最新 run 出現)
//   poll()           — 每 pollMs 跑一次,回 "stop" 結束 follow(pipeline 用來偵測 run 重 spawn → 換檔)
//
// truncation 語意統一:任何 implementation 一旦偵測到檔 size < 已讀位置(in-place 清檔 / rotate-in-place),
// 都把 lastSize reset 到 0 從頭重讀。原 followPipelineLog 不 reset(只靠 poll 偵測「換成新 logPath」),
// 現在統一成「同檔被截斷 → 重讀」+「換新檔 → 由 poll hook 結束」,兩種 case 都 cover。

export type TailFollowOptions = {
  resolveLogPath: () => Promise<string>;
  poll?: {
    intervalMs: number;
    // 回 "stop" → 結束 follow(會印 message 到 stderr 後 complete)
    check: () => Promise<{ stop: true; message?: string } | null>;
  };
  // drain 過程出錯時印的前綴(server: "server log follow stopped")
  errorPrefix: string;
  debounceMs?: number;
};

export async function tailFollow(opts: TailFollowOptions): Promise<void> {
  const debounceMs = opts.debounceMs ?? 100;
  let logPath = "";
  let lastSize = 0;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let reading = false;
  let pending = false;
  let done = false;
  let finish: (() => void) | null = null;

  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (debounce) clearTimeout(debounce);
    if (poll) clearInterval(poll);
    watcher?.close();
    process.off("SIGINT", onSigint);
  };
  const complete = (): void => {
    cleanup();
    finish?.();
  };
  const onSigint = (): void => {
    cleanup();
    process.exit(0);
  };
  const readIncremental = async (): Promise<void> => {
    if (!logPath) return;
    const info = await stat(logPath);
    if (info.size < lastSize) lastSize = 0; // 檔被截斷 → 從頭重讀
    if (info.size <= lastSize) return;
    const file = await open(logPath, "r");
    try {
      let remaining = info.size - lastSize;
      let position = lastSize;
      const buffer = Buffer.alloc(Math.min(64 * 1024, remaining));
      while (remaining > 0) {
        const toRead = Math.min(buffer.length, remaining);
        const { bytesRead } = await file.read(buffer, 0, toRead, position);
        if (bytesRead === 0) break;
        process.stdout.write(buffer.subarray(0, bytesRead));
        position += bytesRead;
        remaining -= bytesRead;
      }
      lastSize = position;
    } finally {
      await file.close();
    }
  };
  const drain = async (): Promise<void> => {
    if (reading) {
      pending = true;
      return;
    }
    reading = true;
    try {
      do {
        pending = false;
        await readIncremental();
      } while (pending);
    } catch (e) {
      process.stderr.write(`${opts.errorPrefix}: ${e instanceof Error ? e.message : String(e)}\n`);
      complete();
    } finally {
      reading = false;
    }
  };
  const scheduleRead = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void drain();
    }, debounceMs);
  };

  process.on("SIGINT", onSigint);
  logPath = await opts.resolveLogPath();
  watcher = watch(logPath, scheduleRead);
  await drain();

  if (opts.poll) {
    const { intervalMs, check } = opts.poll;
    poll = setInterval(() => {
      void (async () => {
        const res = await check();
        if (res?.stop) {
          if (res.message) process.stderr.write(res.message.endsWith("\n") ? res.message : `${res.message}\n`);
          complete();
        }
      })();
    }, intervalMs);
  }

  await new Promise<void>((resolve) => {
    finish = resolve;
  });
}

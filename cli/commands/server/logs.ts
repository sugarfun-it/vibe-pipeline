import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { bool, type ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson } from "../../lib/output";
import { serverLogPath, serverStateDir } from "../../lib/serverPath";

export async function serverLogs(args: ParsedArgs): Promise<void> {
  const follow = bool(args.flags["follow"]) || bool(args.flags["f"]);
  if (follow && isJsonMode()) {
    fail("INVALID_ARGS", "--json mode does not support --follow.");
  }
  if (follow) {
    await followServerLog();
    return;
  }

  const logPath = serverLogPath();
  let content = "";
  try {
    content = await readFile(logPath, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      const msg = e instanceof Error ? e.message : String(e);
      fail("IO_ERROR", `讀取 server log 失敗:${msg}`);
    }
  }

  if (isJsonMode()) {
    okJson({ logPath, content });
    return;
  }
  process.stdout.write(content);
}

async function followServerLog(): Promise<void> {
  const logPath = serverLogPath();
  await mkdir(serverStateDir(), { recursive: true });
  if (!existsSync(logPath)) {
    await writeFile(logPath, "", "utf8");
  }

  let lastSize = 0;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let reading = false;
  let pending = false;
  let done = false;
  let finish: (() => void) | null = null;

  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (debounce) clearTimeout(debounce);
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
    const info = await stat(logPath);
    if (info.size < lastSize) lastSize = 0;
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
      process.stderr.write(`server log follow stopped: ${e instanceof Error ? e.message : String(e)}\n`);
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
    }, 100);
  };

  process.on("SIGINT", onSigint);
  watcher = watch(logPath, scheduleRead);
  await drain();
  await new Promise<void>((resolve) => {
    finish = resolve;
  });
}

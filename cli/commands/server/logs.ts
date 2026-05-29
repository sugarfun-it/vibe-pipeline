import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { bool, type ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson } from "../../lib/output";
import { serverLogPath, serverStateDir } from "../../lib/serverPath";
import { tailFollow } from "../../lib/tailFollow";

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
  await tailFollow({
    resolveLogPath: async () => logPath,
    errorPrefix: "server log follow stopped",
  });
}

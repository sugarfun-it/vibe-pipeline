import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRunnerPid,
  writeRunnerPid,
  readRunnerPid,
  clearRunnerPid,
  cmdlineMatchesSession,
} from "./runnerPidFile";

describe("parseRunnerPid", () => {
  test("valid sidecar → info", () => {
    const r = parseRunnerPid(
      JSON.stringify({ pid: 1234, sessionId: "s1", startedAt: 100, kind: "ticket" })
    );
    expect(r).toEqual({ pid: 1234, sessionId: "s1", startedAt: 100, kind: "ticket" });
  });
  test("kind defaults to ticket when missing/unknown", () => {
    expect(parseRunnerPid(JSON.stringify({ pid: 5 }))?.kind).toBe("ticket");
    expect(parseRunnerPid(JSON.stringify({ pid: 5, kind: "weird" }))?.kind).toBe("ticket");
    expect(parseRunnerPid(JSON.stringify({ pid: 5, kind: "sync" }))?.kind).toBe("sync");
  });
  test("malformed JSON → null", () => {
    expect(parseRunnerPid("not json")).toBeNull();
    expect(parseRunnerPid("")).toBeNull();
  });
  test("missing / bad pid → null", () => {
    expect(parseRunnerPid(JSON.stringify({ sessionId: "x" }))).toBeNull();
    expect(parseRunnerPid(JSON.stringify({ pid: 0 }))).toBeNull();
    expect(parseRunnerPid(JSON.stringify({ pid: -3 }))).toBeNull();
    expect(parseRunnerPid(JSON.stringify({ pid: 1.5 }))).toBeNull();
    expect(parseRunnerPid(JSON.stringify({ pid: "1234" }))).toBeNull();
  });
  test("non-object → null", () => {
    expect(parseRunnerPid("123")).toBeNull();
    expect(parseRunnerPid("null")).toBeNull();
    expect(parseRunnerPid('"str"')).toBeNull();
  });
});

describe("cmdlineMatchesSession", () => {
  const sid = "8ba0a2cb-942f-4d6d-8303-535082dd6a5c";
  test("cmdline containing sessionId → true", () => {
    expect(cmdlineMatchesSession(`claude -p --session-id ${sid} --model x`, sid)).toBe(true);
  });
  test("cmdline without sessionId → false (pid recycled to unrelated proc)", () => {
    expect(cmdlineMatchesSession("C:\\Windows\\explorer.exe", sid)).toBe(false);
  });
  test("null cmdline (dead pid) → false", () => {
    expect(cmdlineMatchesSession(null, sid)).toBe(false);
  });
  test("empty sessionId → false (cannot guard against recycle)", () => {
    expect(cmdlineMatchesSession(`claude -p --session-id ${sid}`, "")).toBe(false);
  });
});

describe("sidecar round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-runnerpid-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("write → read → clear", async () => {
    const pid = "019ed41004f8-web-oa-name";
    expect(readRunnerPid(dir, pid)).toBeNull();
    await writeRunnerPid(dir, pid, { pid: 999, sessionId: "abc", startedAt: 42, kind: "ticket" });
    expect(readRunnerPid(dir, pid)).toEqual({ pid: 999, sessionId: "abc", startedAt: 42, kind: "ticket" });
    clearRunnerPid(dir, pid);
    expect(readRunnerPid(dir, pid)).toBeNull();
  });

  test("clear is idempotent / safe when absent", () => {
    expect(() => clearRunnerPid(dir, "nonexistent")).not.toThrow();
  });

  test("clearRunnerPid with pid guard only deletes on match", async () => {
    const pid = "guarded-pipeline";
    await writeRunnerPid(dir, pid, { pid: 111, sessionId: "s", startedAt: 1, kind: "ticket" });
    clearRunnerPid(dir, pid, 222); // different pid → keep
    expect(readRunnerPid(dir, pid)?.pid).toBe(111);
    clearRunnerPid(dir, pid, 111); // match → delete
    expect(readRunnerPid(dir, pid)).toBeNull();
  });
});

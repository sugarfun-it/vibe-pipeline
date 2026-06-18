import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendFile, unlink } from "node:fs/promises";
import { readPipeline, mutatePipeline } from "../../domain/pipeline";
import { getTaskConfigWithAdapter } from "../../domain/userConfig";
import { runCapture } from "../../io/childSpawn";
import type { Pipeline, Ticket, TaskClass, TaskModelConfig } from "../../../../shared/types";
import { buildCriticPrompt, buildExecutorPrompt, buildMergePrompt } from "../runnerPrompt";

type ActiveProcess = (proc: Bun.Subprocess | null) => void | Promise<void>;

export type CodeRunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type Ctx = {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
  worktreePath: string;
  logFile: string;
  onProcess: ActiveProcess;
};

type AgentResult = {
  text: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type Verdict = "PASS" | "FAIL" | "PARTIAL";

class TransientAgentError extends Error {
  constructor(message: string) {
    super(message);
  }
}

class OrchestratorStopped extends Error {
  constructor() {
    super("orchestrator stopped");
  }
}

export async function runCodeOrchestrator(ctx: Ctx): Promise<CodeRunnerResult> {
  let stdout = "";
  let stderr = "";
  try {
    await log(ctx, "Backend code orchestrator started\n");
    while (true) {
      const p = (await readPipeline(ctx.projectPath, ctx.pipelineId)) as Pipeline | null;
      if (!p) throw new Error("Pipeline not found: " + ctx.pipelineId);
      if (p.state !== "running") {
        await log(ctx, "Pipeline state is " + p.state + "; stopping orchestrator\n");
        return { exitCode: 0, stdout, stderr };
      }
      const selected = selectNextTicket(p);
      if (selected.kind === "ready") {
        await mutatePipeline(ctx.projectPath, ctx.pipelineId, (cur) => ({ ...cur, state: "ready" }), {
          source: "code-orchestrator",
          sourceDetail: "all tickets done",
        });
        return { exitCode: 0, stdout, stderr };
      }
      if (selected.kind === "blocked") {
        await mutatePipeline(ctx.projectPath, ctx.pipelineId, (cur) => ({ ...cur, state: "paused" }), {
          source: "code-orchestrator",
          sourceDetail: "failed ticket blocks pipeline",
        });
        return { exitCode: 0, stdout, stderr };
      }

      try {
        await markTicketRunning(ctx, selected.ticket.id);
        const result = await runTicket(ctx, selected.ticket.id);
        stdout += result.stdout;
        stderr += result.stderr;
      } catch (e) {
        if (e instanceof OrchestratorStopped) {
          return { exitCode: 0, stdout, stderr };
        }
        if (e instanceof TransientAgentError) {
          stderr += e.message + "\n";
          await markTransient(ctx, selected.ticket.id, e.message);
          return { exitCode: 1, stdout, stderr };
        }
        throw e;
      }
    }
  } catch (e) {
    stderr += String(e) + "\n";
    await log(ctx, "Backend code orchestrator error: " + String(e) + "\n");
    await pauseRunningTicket(ctx, String(e));
    return { exitCode: 1, stdout, stderr };
  } finally {
    await ctx.onProcess(null);
  }
}

function selectNextTicket(p: Pipeline):
  | { kind: "ready" }
  | { kind: "blocked" }
  | { kind: "ticket"; ticket: Ticket } {
  const tickets = [...(p.tickets ?? [])].sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  for (const t of tickets) {
    if (t.status === "done") continue;
    if (t.status === "failed_iter_limit" && t.iterStopAtLimit === false) continue;
    if (t.status === "failed" || t.status === "failed_iter_limit" || t.status === "failed_transient") {
      return { kind: "blocked" };
    }
    if (t.status === "draft" || t.status === "ready" || t.status === "paused" || t.status === "running") {
      return { kind: "ticket", ticket: t };
    }
  }
  return { kind: "ready" };
}

async function runTicket(ctx: Ctx, ticketId: string): Promise<{ stdout: string; stderr: string }> {
  const ticket = await getTicket(ctx, ticketId);
  if (!ticket) throw new Error("Ticket not found: " + ticketId);
  if (ticket.mode === "step") return runStep(ctx, ticket);
  if (ticket.mode === "iter") return runIter(ctx, ticket);
  if (ticket.mode === "merge") return runMerge(ctx, ticket);
  await setTicketFailed(ctx, ticket.id, "Unsupported ticket mode: " + ticket.mode, true);
  return { stdout: "", stderr: "" };
}

async function runStep(ctx: Ctx, ticket: Ticket): Promise<{ stdout: string; stderr: string }> {
  const startedAt = Date.now();
  await updateTicket(ctx, ticket.id, (t) => ({ ...t, startedAt, status: "running" }), "step start");
  const cfg = await getAgentConfig("executor");
  const prompt = buildExecutorPrompt({ ticket, config: cfg });
  const agent = await runAgent(ctx, "executor", cfg, prompt.systemPrompt, prompt.prompt);
  const check = await verifyTicket(ctx.worktreePath, ticket, "step", null);
  const endedAt = Date.now();
  if (!check.ok) {
    await updateTicket(ctx, ticket.id, (t) => ({
      ...t,
      status: "failed",
      endedAt,
      reason: check.reason,
    }), "step failed");
    await mutatePipeline(ctx.projectPath, ctx.pipelineId, (p) => ({ ...p, state: "paused" }), {
      source: "code-orchestrator",
      sourceDetail: "step failed",
    });
    return { stdout: agent.stdout, stderr: agent.stderr };
  }
  await updateTicket(ctx, ticket.id, (t) => ({ ...t, status: "done", endedAt }), "step done");
  await commitTicket(ctx, ticket.id, agent.text);
  return { stdout: agent.stdout, stderr: agent.stderr };
}

async function runIter(ctx: Ctx, initialTicket: Ticket): Promise<{ stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  let feedback = lastFeedback(initialTicket);
  let ticket = await ensureIter(ctx, initialTicket.id);
  const limit = Math.max(1, Math.floor(ticket.iterLimit ?? 5));
  const stopAtLimit = ticket.iterStopAtLimit ?? true;

  while ((ticket.iter?.current ?? 0) < limit) {
    const current = ticket.iter?.current ?? 0;
    const roundN = current + 1;
    let executorSummary = "";
    const stage = normalizeStage(ticket.iter?.stage);
    let startedAt = Date.now();

    if (stage === "critic") {
      const existing = ticket.iter?.rounds?.[current];
      startedAt = existing?.startedAt ?? startedAt;
      executorSummary = existing?.executorSummary || "(resumed from pause; prior executor worktree changes preserved)";
    } else if (stage === "done") {
      await updateTicket(ctx, ticket.id, (t) => ({ ...t, status: "done" }), "iter stage done");
      await commitTicket(ctx, ticket.id, lastExecutorSummary(ticket));
      return { stdout, stderr };
    } else {
      await updateTicket(ctx, ticket.id, (t) => {
        const iter = ensureIterObj(t);
        const rounds = [...(iter.rounds ?? [])];
        rounds[current] = {
          ...rounds[current],
          n: roundN,
          startedAt,
        };
        return { ...t, iter: { ...iter, stage: "doer", rounds } };
      }, "iter doer start");
      const executorCfg = await getAgentConfig("executor");
      const executorPrompt = buildExecutorPrompt({ ticket, feedback, round: roundN, config: executorCfg });
      const agent = await runAgent(ctx, "executor", executorCfg, executorPrompt.systemPrompt, executorPrompt.prompt);
      stdout += agent.stdout;
      stderr += agent.stderr;
      executorSummary = summarize(agent.text);
    }

    await updateTicket(ctx, ticket.id, (t) => {
      const iter = ensureIterObj(t);
      const rounds = [...(iter.rounds ?? [])];
      rounds[current] = {
        ...rounds[current],
        n: roundN,
        startedAt,
        executorSummary,
      };
      return { ...t, iter: { ...iter, stage: "critic", rounds } };
    }, "iter critic start");

    const criticCfg = await getAgentConfig("critic");
    const freshTicket = (await getTicket(ctx, ticket.id)) ?? ticket;
    const criticPrompt = buildCriticPrompt({ ticket: freshTicket, executorSummary, config: criticCfg });
    const critic = await runAgent(ctx, "critic", criticCfg, criticPrompt.systemPrompt, criticPrompt.prompt);
    stdout += critic.stdout;
    stderr += critic.stderr;
    const verdict = parseVerdict(critic.text);
    const mechanical = await verifyTicket(ctx.worktreePath, freshTicket, "iter", verdict);
    const finalVerdict: Verdict = verdict === "PASS" && mechanical.ok ? "PASS" : verdict === "PASS" ? "FAIL" : verdict;
    feedback = finalVerdict === "PASS" ? "" : mergeFeedback(critic.text, mechanical.reason);
    const endedAt = Date.now();

    await updateTicket(ctx, ticket.id, (t) => {
      const iter = ensureIterObj(t);
      const rounds = [...(iter.rounds ?? [])];
      rounds[current] = {
        ...rounds[current],
        n: roundN,
        startedAt,
        endedAt,
        executorSummary,
        criticVerdict: finalVerdict,
        criticFeedback: feedback,
      };
      return {
        ...t,
        iter: {
          ...iter,
          current: current + 1,
          stage: finalVerdict === "PASS" ? "done" : "doer",
          rounds,
          verdicts: [...(iter.verdicts ?? []), finalVerdict],
        },
      };
    }, "iter round done");

    if (finalVerdict === "PASS") {
      await updateTicket(ctx, ticket.id, (t) => ({ ...t, status: "done", endedAt }), "iter done");
      await commitTicket(ctx, ticket.id, executorSummary);
      return { stdout, stderr };
    }
    ticket = (await getTicket(ctx, ticket.id)) ?? ticket;
  }

  await updateTicket(ctx, ticket.id, (t) => ({ ...t, status: "failed_iter_limit", endedAt: Date.now() }), "iter limit");
  if (stopAtLimit) {
    await mutatePipeline(ctx.projectPath, ctx.pipelineId, (p) => ({ ...p, state: "paused" }), {
      source: "code-orchestrator",
      sourceDetail: "iterStopAtLimit=true",
    });
  }
  return { stdout, stderr };
}

async function runMerge(ctx: Ctx, ticket: Ticket): Promise<{ stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  let feedback = lastFeedback(ticket);
  const limit = Math.max(1, Math.floor(ticket.iterLimit ?? 2));
  for (let i = ticket.iter?.current ?? 0; i < limit; i++) {
    const roundN = i + 1;
    const startedAt = Date.now();
    await updateTicket(ctx, ticket.id, (t) => {
      const iter = ensureIterObj(t);
      const rounds = [...(iter.rounds ?? [])];
      rounds[i] = { ...rounds[i], n: roundN, startedAt };
      return { ...t, iter: { ...iter, stage: "doer", rounds } };
    }, "merge round start");

    const cfg = await getAgentConfig("merge");
    const prompt = buildMergePrompt({ ticket, feedback, config: cfg });
    const agent = await runAgent(ctx, "merge", cfg, prompt.systemPrompt, prompt.prompt);
    stdout += agent.stdout;
    stderr += agent.stderr;
    const mergeVerdict = parseMergeVerdict(agent.text);
    const verified = mergeVerdict.kind === "PASS"
      ? await verifyMerge(ctx.projectPath, agent.text)
      : { ok: false, reason: mergeVerdict.feedback };
    const endedAt = Date.now();
    feedback = verified.ok ? "" : mergeFeedback(agent.text, verified.reason);

    await updateTicket(ctx, ticket.id, (t) => {
      const iter = ensureIterObj(t);
      const rounds = [...(iter.rounds ?? [])];
      rounds[i] = {
        ...rounds[i],
        n: roundN,
        startedAt,
        endedAt,
        executorSummary: summarize(agent.text),
        criticVerdict: verified.ok ? "PASS" : "FAIL",
        criticFeedback: feedback,
      };
      return {
        ...t,
        iter: {
          ...iter,
          current: i + 1,
          stage: verified.ok ? "done" : "doer",
          rounds,
          verdicts: [...(iter.verdicts ?? []), verified.ok ? "PASS" : "FAIL"],
        },
      };
    }, "merge round done");

    if (verified.ok) {
      const commit = await mergeCommitRef(ctx.projectPath, agent.text);
      await mutatePipeline(ctx.projectPath, ctx.pipelineId, (p) => ({
        ...p,
        state: "merged",
        mergedAt: Date.now(),
        mergeCommit: commit,
        tickets: p.tickets.map((t) => t.id === ticket.id ? { ...t, status: "done", endedAt, commits: [commit] } : t),
      }), {
        source: "code-orchestrator",
        sourceDetail: "merge ticket passed backend verification",
      });
      return { stdout, stderr };
    }
    if (mergeVerdict.kind === "FAIL_NORETRY") break;
  }

  await updateTicket(ctx, ticket.id, (t) => ({ ...t, status: "failed_iter_limit", endedAt: Date.now() }), "merge failed");
  await mutatePipeline(ctx.projectPath, ctx.pipelineId, (p) => ({ ...p, state: "paused" }), {
    source: "code-orchestrator",
    sourceDetail: "merge ticket failed",
  });
  return { stdout, stderr };
}

async function runAgent(
  ctx: Ctx,
  role: TaskClass & ("executor" | "critic" | "merge"),
  cfg: TaskModelConfig & { adapter: import("../../cli").CliAdapter },
  systemPrompt: string,
  prompt: string,
): Promise<AgentResult> {
  let proc: Bun.Subprocess;
  try {
    proc = cfg.adapter.spawn({
      kind: "subagent",
      role,
      cwd: role === "merge" ? ctx.worktreePath : ctx.worktreePath,
      systemPrompt,
      prompt,
      model: cfg.model,
      effort: cfg.effort,
    });
  } catch (e) {
    throw new TransientAgentError("spawn " + role + " failed: " + String(e));
  }
  await ctx.onProcess(proc);
  await log(ctx, "\n--- " + role + " stdout ---\n");
  const [stdout, stderr, exited] = await Promise.all([
    proc.stdout ? new Response(proc.stdout as ReadableStream<Uint8Array>).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr as ReadableStream<Uint8Array>).text() : Promise.resolve(""),
    proc.exited,
  ]);
  await ctx.onProcess(null);
  await log(ctx, stdout + "\n--- " + role + " stderr ---\n" + stderr + "\n");
  const exitCode = proc.exitCode ?? exited;
  if (exitCode !== 0 || /\b(turn\.failed|thread\.failed)\b/.test(stdout)) {
    if (!(await isPipelineRunning(ctx))) throw new OrchestratorStopped();
    throw new TransientAgentError(role + " exited non-zero or provider failed; code=" + String(exitCode));
  }
  let text = "";
  try {
    text = cfg.adapter.parseResult("subagent", stdout);
  } catch (e) {
    if (!(await isPipelineRunning(ctx))) throw new OrchestratorStopped();
    throw new TransientAgentError(role + " result parse failed: " + String(e));
  }
  return { text, stdout, stderr, exitCode };
}

async function isPipelineRunning(ctx: Ctx): Promise<boolean> {
  const p = (await readPipeline(ctx.projectPath, ctx.pipelineId)) as { state?: string } | null;
  return p?.state === "running";
}

async function getAgentConfig(role: "executor" | "critic" | "merge") {
  return getTaskConfigWithAdapter(role);
}

async function markTicketRunning(ctx: Ctx, ticketId: string): Promise<void> {
  await updateTicket(ctx, ticketId, (t) => ({
    ...t,
    status: "running",
    startedAt: t.startedAt ?? Date.now(),
  }), "mark running before sub-agent spawn");
}

async function markTransient(ctx: Ctx, ticketId: string, reason: string): Promise<void> {
  const now = Date.now();
  await mutatePipeline(ctx.projectPath, ctx.pipelineId, (p) => ({
    ...p,
    state: "paused",
    tickets: p.tickets.map((t) =>
      t.id === ticketId || t.status === "running"
        ? { ...t, status: "failed_transient", endedAt: now, reason }
        : t
    ),
  }), {
    source: "code-orchestrator.transient",
    sourceDetail: reason,
  });
}

async function pauseRunningTicket(ctx: Ctx, reason: string): Promise<void> {
  const now = Date.now();
  await mutatePipeline(ctx.projectPath, ctx.pipelineId, (p) => ({
    ...p,
    state: "paused",
    tickets: p.tickets.map((t) =>
      t.status === "running" ? { ...t, status: "failed_transient", endedAt: now, reason } : t
    ),
  }), {
    source: "code-orchestrator.error",
    sourceDetail: reason,
  }).catch(() => undefined);
}

async function setTicketFailed(ctx: Ctx, ticketId: string, reason: string, pause: boolean): Promise<void> {
  await mutatePipeline(ctx.projectPath, ctx.pipelineId, (p) => ({
    ...p,
    state: pause ? "paused" : p.state,
    tickets: p.tickets.map((t) => t.id === ticketId ? { ...t, status: "failed", endedAt: Date.now(), reason } : t),
  }), {
    source: "code-orchestrator",
    sourceDetail: reason,
  });
}

async function updateTicket(
  ctx: Ctx,
  ticketId: string,
  update: (t: Ticket) => Ticket,
  detail: string,
): Promise<void> {
  await mutatePipeline(ctx.projectPath, ctx.pipelineId, (p) => ({
    ...p,
    tickets: p.tickets.map((t) => t.id === ticketId ? update(t) : t),
  }), {
    source: "code-orchestrator",
    sourceDetail: detail,
  });
}

async function getTicket(ctx: Ctx, ticketId: string): Promise<Ticket | null> {
  const p = (await readPipeline(ctx.projectPath, ctx.pipelineId)) as Pipeline | null;
  return p?.tickets.find((t) => t.id === ticketId) ?? null;
}

async function ensureIter(ctx: Ctx, ticketId: string): Promise<Ticket> {
  await updateTicket(ctx, ticketId, (t) => ({ ...t, iter: ensureIterObj(t) }), "ensure iter");
  const t = await getTicket(ctx, ticketId);
  if (!t) throw new Error("Ticket not found after ensure iter: " + ticketId);
  return t;
}

function ensureIterObj(ticket: Ticket) {
  return {
    current: ticket.iter?.current ?? 0,
    stage: normalizeStage(ticket.iter?.stage),
    verdicts: ticket.iter?.verdicts ?? [],
    rounds: ticket.iter?.rounds ?? [],
  };
}

function normalizeStage(stage: unknown): "doer" | "critic" | "done" {
  if (stage === "critic") return "critic";
  if (stage === "done" || stage === "✓") return "done";
  return "doer";
}

function parseVerdict(text: string): Verdict {
  const first = text.trim().split(/\r?\n/, 1)[0]?.trim().toUpperCase();
  if (first === "PASS" || first === "FAIL" || first === "PARTIAL") return first;
  if (first?.startsWith("PASS")) return "PASS";
  if (first?.startsWith("PARTIAL")) return "PARTIAL";
  return "FAIL";
}

function parseMergeVerdict(text: string): { kind: "PASS" | "FAIL" | "FAIL_NORETRY"; feedback: string } {
  const first = text.trim().split(/\r?\n/, 1)[0]?.trim().toUpperCase();
  if (first?.startsWith("PASS")) return { kind: "PASS", feedback: "" };
  if (first?.startsWith("FAIL_NORETRY")) return { kind: "FAIL_NORETRY", feedback: text };
  return { kind: "FAIL", feedback: text };
}

async function verifyTicket(
  cwd: string,
  ticket: Ticket,
  mode: "step" | "iter",
  criticVerdict: Verdict | null,
): Promise<{ ok: boolean; reason: string }> {
  const conflicts = await hasConflictMarkers(cwd);
  if (conflicts.ok) return { ok: false, reason: "worktree still contains conflict markers" };
  const commands = mechanicalCommands(ticket.acceptance ?? []);
  for (const cmd of commands) {
    const r = await runCapture(cmd, { cwd });
    if (!r.ok) return { ok: false, reason: "mechanical acceptance failed: " + cmd.join(" ") + "\n" + r.err + r.out };
  }
  if (mode === "iter" && criticVerdict !== "PASS") {
    return { ok: false, reason: "critic verdict is " + String(criticVerdict) };
  }
  return { ok: true, reason: "" };
}

async function verifyMerge(projectPath: string, text: string): Promise<{ ok: boolean; reason: string }> {
  const mergeHead = await runCapture(["git", "-C", projectPath, "rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (mergeHead.ok) return { ok: false, reason: "MERGE_HEAD still exists" };
  const conflicts = await hasConflictMarkers(projectPath);
  if (conflicts.ok) return { ok: false, reason: "main repo still contains conflict markers" };
  const status = await runCapture(["git", "-C", projectPath, "status", "--porcelain"]);
  if (!status.ok) return { ok: false, reason: status.err || status.out };
  if (status.out.trim()) return { ok: false, reason: "main repo working tree is not clean" };
  const hash = extractLineValue(text, "MERGE_COMMIT_HASH") || (await runCapture(["git", "-C", projectPath, "rev-parse", "HEAD"])).out.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) return { ok: false, reason: "missing valid merge commit hash" };
  return { ok: true, reason: "" };
}

async function hasConflictMarkers(cwd: string): Promise<{ ok: boolean }> {
  const left = await runCapture(["git", "-C", cwd, "grep", "-n", "<<<<<<<", "--", "."]);
  const right = await runCapture(["git", "-C", cwd, "grep", "-n", ">>>>>>>", "--", "."]);
  return { ok: left.ok || right.ok };
}

function mechanicalCommands(acceptance: string[]): string[][] {
  const text = acceptance.join("\n");
  const cmds: string[][] = [];
  if (text.includes("bunx tsc --noEmit")) cmds.push(["bunx", "tsc", "--noEmit"]);
  if (text.includes("bun run build")) cmds.push(["bun", "run", "build"]);
  const testMatch = text.match(/bun test(?:\s+[^\n\r，。]*)?/);
  if (testMatch) cmds.push(testMatch[0].trim().split(/\s+/));
  return cmds;
}

async function commitTicket(ctx: Ctx, ticketId: string, summary: string): Promise<void> {
  const status = await runCapture(["git", "-C", ctx.worktreePath, "status", "--porcelain"]);
  if (!status.ok || !status.out.trim()) return;
  const ticket = await getTicket(ctx, ticketId);
  if (!ticket) return;
  const add = await runCapture(["git", "-C", ctx.worktreePath, "add", "-A"]);
  if (!add.ok) throw new TransientAgentError("git add failed: " + add.err + add.out);
  const subject = "ticket(" + ticket.n + "): " + ticket.title;
  const tmp = join(tmpdir(), "vp-commit-" + ctx.pipelineId + "-" + ticket.n + "-" + Date.now() + ".txt");
  await Bun.write(tmp, commitMessage(ticket, subject, summary));
  const commit = await runCapture(["git", "-C", ctx.worktreePath, "commit", "-F", tmp]);
  await unlink(tmp).catch(() => undefined);
  if (!commit.ok) throw new TransientAgentError("git commit failed: " + commit.err + commit.out);
  const hash = (await runCapture(["git", "-C", ctx.worktreePath, "rev-parse", "HEAD"])).out.trim();
  await updateTicket(ctx, ticketId, (t) => ({
    ...t,
    commits: [...(t.commits ?? []), { hash, subject, ts: Date.now() }],
  }), "ticket commit");
}

function commitMessage(ticket: Ticket, subject: string, summary: string): string {
  const acceptance = ticket.acceptance ?? [];
  const lines = [
    subject,
    "",
    "Goal: " + (ticket.goal || ""),
    "",
    "Acceptance:",
  ];
  for (const a of acceptance.slice(0, 3)) lines.push("- " + a);
  if (acceptance.length > 3) lines.push("(共 " + acceptance.length + " 條)");
  const verdicts = (ticket.iter?.verdicts ?? []).map((v, i) => "#" + (i + 1) + " " + String(v)).join(" -> ");
  const summaryLines = summarize(summary).split(/\r?\n/).slice(0, 6);
  lines.push("", ...summaryLines);
  if (verdicts) lines.push("", "Verdicts: " + verdicts);
  return lines.join("\n") + "\n";
}

async function mergeCommitRef(projectPath: string, text: string) {
  const hash = extractLineValue(text, "MERGE_COMMIT_HASH") ||
    (await runCapture(["git", "-C", projectPath, "rev-parse", "HEAD"])).out.trim();
  const subject = extractLineValue(text, "MERGE_COMMIT_SUBJECT") ||
    (await runCapture(["git", "-C", projectPath, "log", "-1", "--pretty=%s", "HEAD"])).out.trim();
  return { hash, subject, ts: Date.now() };
}

function extractLineValue(text: string, key: string): string {
  const re = new RegExp("^" + key + "=(.+)$", "im");
  return text.match(re)?.[1]?.trim() ?? "";
}

function lastFeedback(ticket: Ticket): string {
  const rounds = ticket.iter?.rounds ?? [];
  return rounds[rounds.length - 1]?.criticFeedback ?? "";
}

function lastExecutorSummary(ticket: Ticket): string {
  const rounds = ticket.iter?.rounds ?? [];
  return rounds[rounds.length - 1]?.executorSummary ?? "";
}

function mergeFeedback(aiText: string, mechanicalReason: string): string {
  return [aiText.trim(), mechanicalReason ? "Backend verification: " + mechanicalReason : ""]
    .filter(Boolean)
    .join("\n\n");
}

function summarize(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 1200) return trimmed;
  return trimmed.slice(trimmed.length - 1200);
}

async function log(ctx: Ctx, text: string): Promise<void> {
  await appendFile(ctx.logFile, text, "utf8").catch(() => undefined);
}

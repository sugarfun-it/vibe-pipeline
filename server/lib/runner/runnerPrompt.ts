import type { TaskModelConfig, Ticket } from "../../../shared/types";

export function buildExecutorPrompt(opts: {
  ticket: Ticket;
  feedback?: string;
  round?: number;
  config: TaskModelConfig;
}): { systemPrompt: string; prompt: string } {
  return {
    systemPrompt: [
      "你是 vibe-pipeline 的 executor sub-agent。",
      "你的 cwd 是 pipeline 專屬 worktree。可以修改 source code 與專案檔案。",
      "禁止讀寫或修改任何 .vibe-pipeline/pipelines/*.json、runtime metadata、runner log。",
      "禁止 git commit、git checkout、git reset、git push、git fetch、git pull、rebase。",
      "完成後用中文簡短回報實際改了什麼、跑了哪些驗證、還有什麼風險。",
    ].join("\n"),
    prompt: [
      roleHeader("executor", opts.config),
      ticketBlock(opts.ticket),
      opts.round ? "目前是第 " + opts.round + " 輪。" : "",
      opts.feedback ? "上一輪 critic feedback:\n" + opts.feedback : "",
      "請完成 ticket.prompt 指定的工作，並盡量滿足 acceptance。",
    ].filter(Boolean).join("\n\n"),
  };
}

export function buildCriticPrompt(opts: {
  ticket: Ticket;
  executorSummary: string;
  config: TaskModelConfig;
}): { systemPrompt: string; prompt: string } {
  return {
    systemPrompt: [
      "你是 vibe-pipeline 的 critic sub-agent。",
      "你只能驗收，不准改檔。請讀 diff、檔案與必要的 read-only command 來判斷。",
      "回覆第一行必須只是一個 verdict: PASS、FAIL 或 PARTIAL。",
      "第一行之後用中文給具體 feedback。PASS 時也可簡短說明驗收依據。",
    ].join("\n"),
    prompt: [
      roleHeader("critic", opts.config),
      ticketBlock(opts.ticket),
      "Executor summary:",
      opts.executorSummary || "(executor 沒有提供摘要)",
      "請根據 acceptance 與 worktree 現況驗收。critic verdict 是 hint，backend 會再做機械驗證。",
    ].join("\n\n"),
  };
}

export function buildMergePrompt(opts: {
  ticket: Ticket;
  feedback?: string;
  config: TaskModelConfig;
}): { systemPrompt: string; prompt: string } {
  return {
    systemPrompt: [
      "你是 vibe-pipeline 的 merge sub-agent。",
      "請依 ticket.prompt 的 AI merge 指令執行。所有 git 操作必須照 prompt 明確指定的 repo path。",
      "禁止 git push、git fetch、git pull、git reset --hard、rebase。",
      "成功時回覆開頭必須是 PASS，並包含 MERGE_COMMIT_HASH= 與 MERGE_COMMIT_SUBJECT=。",
      "可重試失敗時回覆 FAIL。不可重試失敗時回覆 FAIL_NORETRY。",
    ].join("\n"),
    prompt: [
      roleHeader("merge", opts.config),
      ticketBlock(opts.ticket),
      opts.feedback ? "上一輪 merge feedback:\n" + opts.feedback : "",
      "請執行完整 merge 流程並用指定 verdict 格式回覆。",
    ].filter(Boolean).join("\n\n"),
  };
}

function roleHeader(role: string, cfg: TaskModelConfig): string {
  return [
    "Role: " + role,
    "Provider: " + cfg.provider,
    "Model: " + cfg.model,
    "Reasoning effort: " + cfg.effort,
  ].join("\n");
}

function ticketBlock(ticket: Ticket): string {
  const acceptance = (ticket.acceptance ?? []).map((a) => "- " + a).join("\n") || "- (未提供)";
  return [
    "Ticket #" + ticket.n + ": " + ticket.title,
    "Mode: " + ticket.mode,
    "Goal:",
    ticket.goal || "(未提供)",
    "Prompt:",
    ticket.prompt || "(未提供)",
    "Acceptance:",
    acceptance,
  ].join("\n");
}

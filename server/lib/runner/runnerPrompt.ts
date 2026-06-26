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
      "只在 cwd(pipeline 專屬 worktree)內改檔與驗證;禁止 cd 出去、禁止用 worktree 外的絕對路徑改檔。",
      "缺檔(如 .env)在 cwd 內處理,絕不跑去別的 repo / main 工作目錄動手 —— 那會讓改動不進 branch、整個 ticket 白做。",
      "交付物必須是 git 追蹤得到的檔(會出現在 git status);產出落在 .gitignore 路徑等於沒交付,需要的話調整該 repo 的 .gitignore。",
      "只動與本 ticket 相關的檔,範圍外的改動視為違規。",
      "禁止讀寫或修改任何 .vibe-pipeline/pipelines/*.json、runtime metadata、runner log。",
      "禁止 git commit、git checkout、git reset、git push、git fetch、git pull、rebase(commit 由 backend 做)。",
      "完成後用中文簡短回報實際改了什麼、跑了哪些驗證、還有什麼風險。",
    ].join("\n"),
    prompt: [
      ticketBlock(opts.ticket),
      opts.round ? "目前是第 " + opts.round + " 輪。" : "",
      opts.feedback ? "上一輪 critic feedback:\n" + opts.feedback : "",
      "請完成 ticket.prompt 指定的工作，並盡量滿足 acceptance。",
    ].filter(Boolean).join("\n\n"),
  };
}

// integration critic:全 ticket done、轉 ready 前跑一次。各 ticket 自己的 critic 只看自己範圍,
// 跨 ticket 契約(producer/consumer 對不對得上)沒人驗。這道只讀整合後 branch diff 抓那類不一致。
export function buildIntegrationCriticPrompt(opts: {
  pipeline: { name?: string; tickets?: Array<{ n?: number; title?: string; goal?: string; mode?: string }> };
  diff: string;
  config: TaskModelConfig;
}): { systemPrompt: string; prompt: string } {
  const goals = (opts.pipeline.tickets ?? [])
    .filter((t) => t.mode !== "merge")
    .map((t) => "#" + t.n + " " + (t.title ?? "") + "\n  goal: " + (t.goal ?? "(未提供)"))
    .join("\n");
  return {
    systemPrompt: [
      "你是 vibe-pipeline 的 integration critic。所有 ticket 各自已過自己的 acceptance,",
      "但各自 critic 只看自己範圍,沒人檢查 ticket 之間兜不兜得起來。你只讀整合後 branch diff,不准改檔。",
      "只看『跨 ticket 一致性』:producer/consumer 的 API 路徑/參數/型別/契約對不對得上、",
      "前後端送收欄位有沒有漏(如必填參數沒帶)、import/export 名稱對不對、共用型別有沒有對齊。",
      "不要重驗各 ticket 自己的功能,只抓『單 ticket 看不出、合起來才壞』的不一致。",
      "回覆第一行只能是 verdict:PASS 或 FAIL。FAIL 時之後用中文列出具體不一致 + 在哪個檔 / 哪兩張 ticket 之間。",
    ].join("\n"),
    prompt: [
      "Pipeline: " + (opts.pipeline.name ?? ""),
      "各 ticket goal:",
      goals || "(無)",
      "整合後 branch diff(對 base):",
      opts.diff || "(無 diff)",
    ].join("\n\n"),
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
      "你只能驗收,不准改檔。請讀實際 diff、檔案與必要的 read-only command 來判斷。",
      "executor summary 只是 hint,一律以 worktree 實際 diff / 檔案為準;summary 與實際不符時以實際為準。",
      "若 worktree 沒有任何未提交改動(git status 乾淨)→ 一律 FAIL:executor 沒在 worktree 留下交付(可能改去了別處或落在 .gitignore)。",
      "回覆第一行必須只是一個 verdict: PASS 或 FAIL。",
      "第一行之後用中文給具體 feedback。PASS 時也可簡短說明驗收依據。",
    ].join("\n"),
    prompt: [
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
      ticketBlock(opts.ticket),
      opts.feedback ? "上一輪 merge feedback:\n" + opts.feedback : "",
      "請執行完整 merge 流程並用指定 verdict 格式回覆。",
    ].filter(Boolean).join("\n\n"),
  };
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

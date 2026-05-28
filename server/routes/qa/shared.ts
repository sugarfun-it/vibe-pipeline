import * as projectStore from "../../lib/domain/project";
import * as projectDir from "../../lib/domain/projectDir";
import { err } from "../_http";
import type { PartialSpec } from "../../../shared/types";

const REQUIRED_FIELDS: { key: keyof PartialSpec; label: string }[] = [
  { key: "title", label: "title(15 字內)" },
  { key: "goal", label: "goal(一句 why)" },
  { key: "acceptance", label: "acceptance(陣列,1-3 條可驗收)" },
  { key: "prompt", label: "prompt(給執行AI 的完整指令)" },
  { key: "mode", label: 'mode("step" 或 "iter")' },
];

function fieldFilled(spec: PartialSpec | null, key: keyof PartialSpec): boolean {
  if (!spec) return false;
  const v = spec[key];
  if (v == null || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (key === "mode") return v === "step" || v === "iter";
  return true;
}

export function buildProgressHint(spec: PartialSpec | null, turnNumber: number): string {
  const filled = REQUIRED_FIELDS.filter((f) => fieldFilled(spec, f.key));
  const missing = REQUIRED_FIELDS.filter((f) => !fieldFilled(spec, f.key));
  if (missing.length === 0) {
    return `當前進度:5/5 齊。這輪 spec 必須包含全部 5 欄位內容(不可塌陷),complete 設 true,結束對話。`;
  }
  const filledStr = filled.length > 0 ? filled.map((f) => f.key).join(" / ") : "(無)";
  const missingStr = missing.map((f) => f.label).join(" / ");
  let urgency = "";
  if (turnNumber >= 4) {
    urgency =
      "\n**已第 " +
      turnNumber +
      " 輪,你必須這輪自行填好所有缺的欄位**(用合理預設,不要再問問題)。" +
      "spec 必須含 5 個欄位完整內容,complete 設 true。" +
      "user 答得抽象就你判斷,不要無限拖。";
  } else if (turnNumber >= 3) {
    urgency = "\n第 " + turnNumber + " 輪了,加快推進,1-2 輪內收齊。";
  }
  return `當前進度:${filled.length}/5 齊(已收:${filledStr})。還缺:${missingStr}。${urgency}`;
}



type ProjectFor =
  | { error: Response }
  | { project: NonNullable<Awaited<ReturnType<typeof projectStore.findByHash>>> };
export async function projectFor(hash: string): Promise<ProjectFor> {
  const p = await projectStore.findByHash(hash);
  if (!p) return { error: err("not_found", `Project not found: ${hash}`, 404) };
  if (!projectDir.hasInit(p.path))
    return { error: err("not_initialized", `.vibe-pipeline/ not found in ${p.path}`) };
  return { project: p };
}

// 把 pipeline 內現有 ticket 摘成一段 context 給 QA AI 看。
// 引導它別建跟既有 ticket 高度重疊的新 ticket。
export function buildPipelineContext(
  pipeline: { tickets?: Array<Record<string, unknown>> } | null
): string | undefined {
  const tickets = pipeline?.tickets ?? [];
  if (tickets.length === 0) return undefined;
  const MAX = 20;
  const shown = tickets.slice(0, MAX);
  const lines: string[] = [
    "PIPELINE 內已存在的 ticket(請避免新 ticket 重複既有任務範圍):",
  ];
  for (const t of shown) {
    const n = typeof t.n === "number" ? t.n : "?";
    const status = typeof t.status === "string" ? t.status : "?";
    const mode = typeof t.mode === "string" ? t.mode : "?";
    const title = typeof t.title === "string" ? t.title : "(no title)";
    const goal = typeof t.goal === "string" ? truncate(t.goal, 140) : "";
    lines.push(`#${n} [${status}/${mode}] ${title}`);
    if (goal) lines.push(`   goal: ${goal}`);
  }
  if (tickets.length > MAX) lines.push(`...還有 ${tickets.length - MAX} 條未列`);
  lines.push("");
  lines.push(
    "如果 user 描述跟某張現有 ticket 高度重疊,在 message 提醒「這已經有 #N 在做了」,引導 user 縮 scope 或換主題;新 ticket 應該是補完既有,不是重做。"
  );
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

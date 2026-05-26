import * as draftStore from "../../lib/qa/draftStore";
import * as cli from "../../lib/qa/claudeCli";
import { requireJsonUtf8, ok, err, readJson } from "../_http";
import { buildProgressHint, projectFor } from "./shared";

export async function turn(hash: string, draftId: string, req: Request): Promise<Response> {
  const guardErr = requireJsonUtf8(req);
  if (guardErr) return guardErr;
  const r = await projectFor(hash);
  if ("error" in r) return r.error;
  const { project } = r;

  const body = await readJson(req);
  const userMessage = (body.userMessage as string) ?? "";
  if (!userMessage.trim()) return err("invalid_path", "userMessage required");

  const draft = await draftStore.readDraft(project.path, draftId);
  if (!draft) return err("not_found", `Draft not found: ${draftId}`, 404);

  const isFirstTurn = !draft.sessionStarted;

  // 算 progress hint 讓 AI 知道目前進度 + 還缺什麼。
  // 規則:
  // - 累計 user 輪數 >= 3 且 spec < 5/5 → 強催 AI 自填預設一次到位
  // - spec partial → 列缺欄位
  const userTurns = draft.turns.filter((t) => t.role === "user").length;
  const progressHint = !isFirstTurn ? buildProgressHint(draft.spec, userTurns + 1) : undefined;

  // snapshot priorTurns 在 appendUserMessage 之前 — history 不能含本輪 userMessage,
  // 否則 codex adapter 會跟 cli.runTurn 另傳的 userMessage 雙寫當輪內容
  const priorTurns = draft.turns.slice();

  // 先把 user message 寫進 disk(claude 跑前的中繼狀態),這樣 user 中途關 drawer 再回來
  // 還能看到他剛送的話;之後再 appendTurn(userMessage=null)只 append AI reply
  await draftStore.appendUserMessage(project.path, draftId, userMessage);

  let reply: Awaited<ReturnType<typeof cli.runTurn>>;
  try {
    // history:把 priorTurns(本輪 userMessage 寫入前的快照)轉成 codex adapter 需要的形狀。
    // claude adapter 會忽略(--resume 從 session 接續);codex 沒 session resume,必須自帶 transcript。
    const history = priorTurns.map((t) => ({
      role: (t.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: t.message,
    }));
    reply = await cli.runTurn({
      cwd: project.path,
      sessionId: draft.sessionId,
      userMessage,
      isFirstTurn,
      progressHint,
      pipelineContext: draft.pipelineContext,
      history,
    });
  } catch (e) {
    return err("internal_error", String(e), 500);
  }

  if (isFirstTurn) await draftStore.markStarted(project.path, draftId);
  // userMessage=null:user 已先寫過,這裡只 append AI reply + merge spec + 更新 complete
  const updated = await draftStore.appendTurn(project.path, draftId, null, reply);
  return ok({ draft: updated, reply });
}

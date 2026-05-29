import * as pipelineStore from "../../lib/domain/pipeline";
import * as draftStore from "../../lib/qa/draftStore";
import * as cli from "../../lib/qa/claudeCli";
import { ok, err } from "../_http";
import { buildPipelineContext, projectFor } from "./shared";

export async function start(hash: string, pipelineId: string, _req: Request): Promise<Response> {
  const r = await projectFor(hash);
  if ("error" in r) return r.error;
  const { project } = r;

  const pipeline = await pipelineStore.readPipeline(project.path, pipelineId);
  if (!pipeline) return err("not_found", `Pipeline not found: ${pipelineId}`, 404);

  const existing = await draftStore.findActiveByPipeline(project.path, pipelineId);
  if (existing) {
    return err("already_initialized", `Active draft exists: ${existing.draftId}`, 409);
  }

  if (!(await cli.checkAvailable())) {
    return err(
      "internal_error",
      "claude CLI 不可用 — 請確認已安裝並登入(brew install claude / npm i -g @anthropic-ai/claude-code,然後 `claude login`)",
      503
    );
  }

  // 不打 claude — draft 建好,frontend 會顯示寫死的第一句 + 選項。
  // 第一個真實 claude turn 由 user 點選項 / 打字觸發 /turn。
  const ctx = buildPipelineContext(pipeline as { tickets?: Array<Record<string, unknown>> } | null);
  const draft = await draftStore.createDraft(project.path, pipelineId, ctx);
  return ok({ draft });
}

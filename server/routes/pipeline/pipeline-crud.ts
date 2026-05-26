import * as pipelineDir from '../../lib/pipelineDir';
import { ok, err, withProject, withPipeline, withJsonBody } from '../_http';

export async function listPipelines(hash: string): Promise<Response> {
  return withProject(hash, async (project) => ok(await pipelineDir.listPipelines(project.path)));
}

export async function createPipeline(hash: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => withJsonBody(req, async (body) => {
  const name = (body.name as string) || "pipeline";
  const id = (body.id as string) || pipelineDir.generatePipelineId(name);
  // autoMerge:body 沒帶就讀 project config defaults.auto_merge,有帶就用 body 值(必須是 boolean)
  let autoMerge: boolean;
  if (typeof body.autoMerge === "boolean") {
    autoMerge = body.autoMerge;
  } else {
    const resolved = await pipelineDir.getResolvedDefaults(project.path);
    autoMerge = resolved.auto_merge;
  }
  const branch =
    typeof body.branch === "string" && body.branch.trim()
      ? body.branch
      : "pipeline/" + name.replace(/[\s/]+/g, "-");
  const state = typeof body.state === "string" && body.state.trim() ? body.state : "planning";
  // createdAt 取 body 值(允許 import 帶舊時間)或 Date.now()
  const data = { ...body, id, name, branch, state, autoMerge, createdAt: typeof body.createdAt === "number" ? body.createdAt : Date.now(), tickets: Array.isArray(body.tickets) ? body.tickets : [] };
  await pipelineDir.writePipeline(project.path, id, data, { source: "api-create-pipeline", sourceDetail: `POST /pipelines name=${name}` });
  return ok(data);
  }));
}

export async function getPipeline(hash: string, id: string): Promise<Response> {
  return withPipeline(hash, id, async (_p, pipeline) => ok(pipeline));
}

export async function savePipeline(hash: string, id: string, req: Request): Promise<Response> {
  return withProject(hash, async (project) => withJsonBody(req, async (body) => {
  const existing = (await pipelineDir.readPipeline(project.path, id)) as {
    state?: string;
  } | null;
  // PUT 不准用來建立新 pipeline(用 POST /pipelines)— 避免 typo 路徑悄悄 upsert
  if (!existing) {
    return err("not_found", `Pipeline not found: ${id}(建立用 POST /pipelines)`, 404);
  }
  // Race guard:running / queued 時禁止 PUT,避免覆蓋 runner 主 agent 正在寫的 iter / commits
  // 或把 queued 狀態踩掉導致 dispatcher 接不到。queued 可走「取消排隊」端點處理。
  if (
    existing.state === "running" ||
    existing.state === "queued"
  ) {
    return err(
      "invalid_path",
      `Pipeline 在 ${existing.state} 狀態,先 pause/取消排隊 才能修改`,
      409
    );
  }
  // 最小 shape 驗證:防止空 body / 半個 body 把整條 pipeline.json 清光
  // (不做完整 spec 驗,只擋明顯壞掉)
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>).name !== "string" ||
    typeof (body as Record<string, unknown>).branch !== "string" ||
    !Array.isArray((body as Record<string, unknown>).tickets)
  ) {
    return err(
      "invalid_path",
      "Body 缺必要欄位:name(string)/ branch(string)/ tickets(array)",
      400
    );
  }
  // autoMerge:若 body 有帶必須是 boolean(不接受 undefined → 維持既有值)
  const bodyAutoMerge = (body as Record<string, unknown>).autoMerge;
  if (bodyAutoMerge !== undefined && typeof bodyAutoMerge !== "boolean") {
    return err("invalid_path", "autoMerge 必須為 boolean", 400);
  }
  const data = { ...body, id };
  await pipelineDir.writePipeline(project.path, id, data, {
    source: "api-handler-explicit",
    sourceDetail: "PUT /pipelines/:id",
    prevStateHint: typeof existing.state === "string" ? existing.state : undefined,
  });
  return ok(data);
  }));
}

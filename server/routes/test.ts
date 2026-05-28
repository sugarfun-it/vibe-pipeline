// E2E 控制端點。只在 VP_TEST_MODE=mock 時 mount(server/index.ts 守)。
// real 模式不存在這些 routes,擋住意外被 production 端點呼叫。

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as projectStore from "../lib/domain/project";
import * as testMode from "../lib/testMode";
import { fakeFcmCalls, resetFakeFcmCalls } from "../lib/remote/fcm";
import { vibeHome } from "../lib/io/paths";
import type { QAReply } from "../../shared/types";
import type { RunnerScript } from "../lib/testMode";
import type { TicketSpec } from "../../shared/types";

function ok(data: unknown): Response {
  return Response.json({ ok: true, data });
}
function err(code: string, message: string, status = 400): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

// POST /api/__test/register-project
// body: { path: string, ensureInit?: boolean, seedPipelines?: Pipeline[] }
// 把 path 加進 recents,選擇性 init .vibe-pipeline/。回 hash 給 spec 用。
export async function registerProject(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    path?: string;
    ensureInit?: boolean;
    seedPipelines?: Array<{ id: string; [k: string]: unknown }>;
  };
  if (!body.path) return err("bad_request", "path required");

  if (body.ensureInit) {
    const dir = join(body.path, ".vibe-pipeline");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const pipelinesDir = join(dir, "pipelines");
    if (!existsSync(pipelinesDir)) mkdirSync(pipelinesDir, { recursive: true });
    const configPath = join(dir, "config.json");
    if (!existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify({ defaults: {} }, null, 2));
    }
    if (Array.isArray(body.seedPipelines)) {
      for (const p of body.seedPipelines) {
        writeFileSync(
          join(pipelinesDir, `${p.id}.json`),
          JSON.stringify(p, null, 2)
        );
      }
    }
  }

  const project = await projectStore.open(body.path);
  return ok({ hash: project.hash, project });
}

// POST /api/__test/script/qa
// body: { hash: string, replies: QAReply[] }
export async function setQAScript(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    hash?: string;
    replies?: QAReply[];
  };
  if (!body.hash || !Array.isArray(body.replies)) {
    return err("bad_request", "hash + replies[] required");
  }
  testMode.setQAScript(body.hash, body.replies);
  return ok({ count: body.replies.length });
}

// POST /api/__test/script/runner
// body: { hash: string, pipelineId: string, script: RunnerScript }
export async function setRunnerScript(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    hash?: string;
    pipelineId?: string;
    script?: RunnerScript;
  };
  if (!body.hash || !body.pipelineId || !body.script) {
    return err("bad_request", "hash + pipelineId + script required");
  }
  testMode.setRunnerScript(body.hash, body.pipelineId, body.script);
  return ok({ ticketCount: body.script.tickets.length });
}

// POST /api/__test/script/split
// body: { hash: string, specs: TicketSpec[] }
// 設定 inline AI 拆分 mock 結果:specs.length>=2 → 拆成 N 張;length 1 → nothingToSplit
export async function setSplitScript(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    hash?: string;
    specs?: TicketSpec[];
  };
  if (!body.hash || !Array.isArray(body.specs)) {
    return err("bad_request", "hash + specs[] required");
  }
  testMode.setSplitScript(body.hash, body.specs);
  return ok({ count: body.specs.length });
}

// POST /api/__test/reset
// 清所有 in-memory mock state(QA / runner script + fake FCM calls)。
// device_tokens.json + gateway-token 也清(避免 fcm spec 在共享 TEST_HOME 下 token 累積汙染下一個 case)。
export async function reset(): Promise<Response> {
  testMode.resetMocks();
  resetFakeFcmCalls();
  try {
    const { unlinkSync } = await import("node:fs");
    const tokensPath = join(vibeHome(), ".vibe-pipeline", "device_tokens.json");
    if (existsSync(tokensPath)) unlinkSync(tokensPath);
    const gatewayTokenPath = join(vibeHome(), ".vibe-pipeline", "gateway-token");
    if (existsSync(gatewayTokenPath)) unlinkSync(gatewayTokenPath);
  } catch {
    // best-effort
  }
  return ok({});
}

// POST /api/__test/seed/rich-pipeline
// body: { hash: string, pipelineId?: string, pipelineName?: string, baseBranch?: string }
// 寫一個 ticket state 豐富(done step+commits / done iter 多輪 / paused / failed_iter_limit /
// ready / draft 共 6 ticket)的 pipeline.json 到 hash 對應的 project,給 iter-uiux drive recipe
// + e2e demo 一鍵 seed 用。pipeline 本身 state=paused,涵蓋 ticket-card / iter-stages / focus-list /
// paused-actions / overflow-menu 等多數視覺單元。
export async function seedRichPipeline(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    hash?: string;
    pipelineId?: string;
    pipelineName?: string;
    baseBranch?: string;
  };
  if (!body.hash) return err("bad_request", "hash required");
  const project = await projectStore.findByHash(body.hash);
  if (!project) return err("not_found", `project not found for hash=${body.hash}`, 404);
  const pipeline = testMode.richTicketPipeline({
    id: body.pipelineId,
    name: body.pipelineName,
    baseBranch: body.baseBranch,
  });
  const pipelinesDir = join(project.path, ".vibe-pipeline", "pipelines");
  if (!existsSync(pipelinesDir)) mkdirSync(pipelinesDir, { recursive: true });
  writeFileSync(
    join(pipelinesDir, `${pipeline.id}.json`),
    JSON.stringify(pipeline, null, 2)
  );
  return ok({ pipeline });
}

// GET /api/__test/fcm/calls
export function fcmCalls(): Response {
  return Response.json({ calls: fakeFcmCalls });
}

// POST /api/__test/fcm/reset
export function fcmReset(): Response {
  resetFakeFcmCalls();
  return Response.json({ ok: true });
}

// GET /api/__test/push/file-content?file=<name>
// 預設讀 device_tokens.json(legacy);fcm spec 可帶 ?file=gateway-token 讀 lazy 取得的 bearer token。
// 只允許白名單避免變成任意檔讀。
export async function pushFileContent(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const requested = url.searchParams.get("file") ?? "device_tokens.json";
  const allowed = new Set(["device_tokens.json", "gateway-token"]);
  const filename = allowed.has(requested) ? requested : "device_tokens.json";
  const path = join(vibeHome(), ".vibe-pipeline", filename);
  const content = existsSync(path) ? await Bun.file(path).text() : "";
  return ok({ filename, content });
}

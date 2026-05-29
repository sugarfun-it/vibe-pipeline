import { resolveProject, requireInit } from "../../lib/project";
import { ensureBackend } from "../../lib/ensureBackend";
import { post } from "../../lib/api";
import type { ParsedArgs } from "../../lib/args";
import { fail, isJsonMode, okJson, print } from "../../lib/output";
import type { CommitRef } from "../../../shared/types";

// AI merge:走 backend POST /merge,backend spawn runner 主 agent。CLI 立刻返回。
export async function pipelineMerge(args: ParsedArgs): Promise<void> {
  const proj = await resolveProject(args.flags);
  await requireInit(proj.path);
  const id = args.positional[0];
  if (!id) fail("INVALID_ARGS", "Usage: vbpl pipeline merge <id>");
  await ensureBackend();

  // 2026-05-13 後 backend 二段式:mechanical → mergeCommit;衝突 fallback ai → ticketId
  type MergeResp =
    | { ok: true; mode: "mechanical"; mergeCommit?: CommitRef; alreadyMerged?: boolean }
    | { ok: true; mode: "ai"; ticketId: string; conflictFiles?: string[] };
  const res = await post<MergeResp>(`/api/projects/${proj.hash}/pipelines/${id}/merge`);

  if (isJsonMode()) {
    okJson({ ...res, pipelineId: id });
    return;
  }
  if (res.mode === "mechanical") {
    if (res.alreadyMerged) {
      print(`Already merged (no-op): ${id}`);
    } else {
      print(`✓ Merged (mechanical, no AI): ${id}`);
      if (res.mergeCommit) print(`  commit: ${res.mergeCommit.hash.slice(0, 7)} - ${res.mergeCommit.subject}`);
    }
  } else {
    const n = res.conflictFiles?.length ?? 0;
    print(`⚠ Conflict (${n} files), AI 接手:ticket=${res.ticketId}`);
    print(`Watch progress: vbpl pipeline log ${id}`);
  }
}

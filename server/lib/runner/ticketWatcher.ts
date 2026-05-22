// 監看 <target>/.vibe-pipeline/pipelines/<id>.json 的變化,
// diff ticket.status 變動 → emit notif (ticket_started / ticket_done / ticket_failed)
// 主 agent 透過 Bash 寫 pipeline.json,我們不依賴主 agent 主動 emit。

import { watch, type FSWatcher } from "node:fs";
import * as pipelineDir from "../pipelineDir";
import * as notifs from "../notifs/store";
import { fanoutPush } from "../fcm/index";
import * as tokenStore from "../push/tokenStore";
import * as testMode from "../testMode";
import { loadUserConfig } from "../userConfig";
import { appendStateChange, listAudit } from "../auditLog";
import type { NotifEventType, PushEventKey } from "../../../shared/types";

type Active = { unwatch: () => void };
const watchers = new Map<string, Active>(); // key: <projHash>:<pipelineId>

function key(projectHash: string, pipelineId: string): string {
  return `${projectHash}:${pipelineId}`;
}

function statusToEvent(status: string): NotifEventType | null {
  if (status === "running") return "ticket_started";
  if (status === "done") return "ticket_done";
  if (status === "failed" || status === "failed_iter_limit" || status === "failed_transient")
    return "ticket_failed";
  return null;
}

type TicketLite = { id?: string; title?: string; status?: string; n?: number };
type PipelineLite = {
  state?: string;
  name?: string;
  tickets?: TicketLite[];
};
type Snapshot = {
  ticketStatuses: Map<string, string>;
  state?: string;
};

async function snapshot(projectPath: string, pipelineId: string): Promise<Snapshot> {
  const p = (await pipelineDir.readPipeline(projectPath, pipelineId)) as PipelineLite | null;
  const ticketStatuses = new Map<string, string>();
  if (p && Array.isArray(p.tickets)) {
    for (const t of p.tickets) {
      if (t.id && t.status) ticketStatuses.set(t.id, t.status);
    }
  }
  return { ticketStatuses, state: p?.state };
}

function currentTicket(tickets: TicketLite[]): TicketLite | undefined {
  return (
    tickets.find((x) => x.status === "running") ??
    tickets.find((x) => x.status === "paused") ??
    tickets.find((x) => x.status === "failed_iter_limit") ??
    tickets.find((x) => x.status === "failed_transient") ??
    tickets.find((x) => x.status === "failed")
  );
}

function currentTicketTitle(tickets: TicketLite[]): string {
  const t = currentTicket(tickets);
  return t?.title || t?.id || "";
}

function pushAsync(opts: {
  eventKey: PushEventKey;
  title: string;
  body: string;
  projectHash: string;
  pipelineId: string;
  ticketId: string;
}): void {
  void (async () => {
    try {
      const cfg = await loadUserConfig();
      if (!cfg.pushEvents[opts.eventKey]) return;
      const records = await tokenStore.listTokens();
      const dead = await fanoutPush(
        records.map((r) => r.token),
        {
          notification: { title: opts.title, body: opts.body },
          data: {
            workUnitId: opts.ticketId,
            url: `/board?project=${opts.projectHash}&pipeline=${opts.pipelineId}`,
          },
        }
      );
      if (dead.length > 0) await tokenStore.removeDeadTokens(dead);
    } catch (e) {
      console.error(`[ticketWatcher ${opts.pipelineId}] push failed:`, e);
    }
  })();
}

export async function start(opts: {
  projectPath: string;
  projectHash: string;
  pipelineId: string;
}): Promise<void> {
  const k = key(opts.projectHash, opts.pipelineId);
  if (watchers.has(k)) return;

  const file = pipelineDir.pipelineFile(opts.projectPath, opts.pipelineId);
  let last = await snapshot(opts.projectPath, opts.pipelineId);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let checking = false;

  const checkForChanges = async () => {
    if (checking) return;
    checking = true;
    try {
      const cur = await snapshot(opts.projectPath, opts.pipelineId);
      const p = (await pipelineDir.readPipeline(
        opts.projectPath,
        opts.pipelineId
      )) as PipelineLite | null;
      const tickets = (p?.tickets ?? []) as TicketLite[];
      for (const [tid, status] of cur.ticketStatuses) {
        const prev = last.ticketStatuses.get(tid);
        if (prev === status) continue;
        const ev = statusToEvent(status);
        if (!ev) continue;
        const t = tickets.find((x) => x.id === tid);
        const titlePart = t?.title || tid;
        const numPart = t?.n != null ? `#${t.n} ` : "";
        notifs.emit(opts.projectPath, {
          type: ev,
          title: `${numPart}${titlePart}: ${status}`,
          pipelineId: opts.pipelineId,
        });
        if (status === "done") {
          pushAsync({
            eventKey: "ticket_done",
            title: "✅ Ticket 完成",
            body: titlePart,
            projectHash: opts.projectHash,
            pipelineId: opts.pipelineId,
            ticketId: tid,
          });
        } else if (
          status === "failed" ||
          status === "failed_iter_limit" ||
          status === "failed_transient"
        ) {
          pushAsync({
            eventKey: "ticket_failed",
            title: "❌ Ticket 失敗",
            body: titlePart,
            projectHash: opts.projectHash,
            pipelineId: opts.pipelineId,
            ticketId: tid,
          });
        }
      }
      // Audit fallback:disk 上 state 變了但 pipelineDir.writePipeline 沒寫 audit
      // (代表是 runner 主 agent 透過 Edit/Write 直接改 pipeline.json,沒走 backend)。
      // 比對 audit.jsonl 最新一筆,若 (from,to) 跟 disk diff 一致 → backend 已記錄,跳過;
      // 否則補一筆 source='runner-self-detected'。
      if (last.state !== cur.state && (last.state !== undefined || cur.state !== undefined)) {
        try {
          const recent = listAudit(opts.projectPath, opts.pipelineId, 1)[0];
          const alreadyLogged =
            recent &&
            recent.from === (last.state ?? "(none)") &&
            recent.to === (cur.state ?? "(none)") &&
            Date.now() - recent.ts < 5000;
          if (!alreadyLogged) {
            appendStateChange({
              projectPath: opts.projectPath,
              pipelineId: opts.pipelineId,
              from: last.state ?? "(none)",
              to: cur.state ?? "(none)",
              source: "runner-self-detected",
              sourceDetail: "ticketWatcher detected disk state change without backend write",
            });
          }
        } catch (e) {
          console.warn(`[ticketWatcher ${opts.pipelineId}] audit fallback failed:`, e);
        }
      }
      if (last.state !== "paused" && cur.state === "paused") {
        const current = currentTicket(tickets);
        const title = currentTicketTitle(tickets);
        pushAsync({
          eventKey: "pipeline_paused",
          title: "⏳ 需要你的回應",
          body: `${p?.name || opts.pipelineId}${title ? ` ${title}` : ""}`,
          projectHash: opts.projectHash,
          pipelineId: opts.pipelineId,
          ticketId: current?.id || opts.pipelineId,
        });
      }
      if (last.state !== "ready" && cur.state === "ready") {
        pushAsync({
          eventKey: "pipeline_ready",
          title: "✅ Pipeline 跑完",
          body: `${p?.name || opts.pipelineId} 全 ticket done,可 merge`,
          projectHash: opts.projectHash,
          pipelineId: opts.pipelineId,
          ticketId: opts.pipelineId,
        });
      }
      last = cur;
    } catch (e) {
      console.error(`[ticketWatcher ${opts.pipelineId}] error:`, e);
    } finally {
      checking = false;
    }
  };

  if (testMode.isTestMode()) {
    poll = setInterval(() => void checkForChanges(), 200);
  }

  let w: FSWatcher;
  try {
    w = watch(file, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void checkForChanges(), 200);
    });
    w.on("error", (e) => {
      console.error(`[ticketWatcher ${opts.pipelineId}] watch error:`, e);
      if (!testMode.isTestMode()) {
        stop({ projectHash: opts.projectHash, pipelineId: opts.pipelineId });
      }
    });
  } catch (e) {
    console.error(`[ticketWatcher ${opts.pipelineId}] watch failed:`, e);
    if (!testMode.isTestMode()) {
      if (poll) clearInterval(poll);
      return;
    }
    w = { close() {} } as FSWatcher;
  }

  watchers.set(k, {
    unwatch: () => {
      try {
        w.close();
      } catch {}
      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);
    },
  });
}

export function stop(opts: { projectHash: string; pipelineId: string }): void {
  const k = key(opts.projectHash, opts.pipelineId);
  const a = watchers.get(k);
  if (!a) return;
  a.unwatch();
  watchers.delete(k);
}

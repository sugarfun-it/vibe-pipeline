// Push fanout 樣板的單一來源(2026-05-29 收斂)。
// 原本 ticketWatcher.pushAsync 與 orchestrator/autoMerge.ts IIFE 是同段:
//   loadUserConfig → pushEvents gate → listTokens → fanoutPush → removeDeadTokens,
// 兩邊各抄一份,url 格式也各寫一份。抽 pushToEvent 兩邊共用,url 格式只留 boardUrl 一份。
//
// 跟既有行為一致:fire-and-forget(caller 不 await)、push 失敗只 console.error 不 throw
// (push 是 best-effort,見 SKILL §Push)。

import { loadUserConfig } from "../../domain/userConfig";
import * as tokenStore from "./tokenStore";
import { fanoutPush } from "../fcm";
import type { PushEventKey } from "../../../../shared/types";

// board deep-link 的唯一格式來源。
export function boardUrl(projectHash: string, pipelineId: string): string {
  return `/board?project=${projectHash}&pipeline=${pipelineId}`;
}

export function pushToEvent(opts: {
  eventKey: PushEventKey;
  title: string;
  body: string;
  projectHash: string;
  workUnitId: string;
  url: string;
}): void {
  void (async () => {
    try {
      const cfg = await loadUserConfig();
      if (!cfg.pushEvents[opts.eventKey]) return;
      const records = await tokenStore.listTokens();
      if (records.length === 0) return;
      const dead = await fanoutPush({
        notification: { title: opts.title, body: opts.body },
        data: {
          workUnitId: opts.workUnitId,
          url: opts.url,
        },
      });
      if (dead.length > 0) await tokenStore.removeDeadTokens(dead);
    } catch (e) {
      console.error(`[pushToEvent ${opts.eventKey}] push failed:`, e);
    }
  })();
}

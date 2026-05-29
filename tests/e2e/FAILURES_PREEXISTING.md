# Full Mock E2E Pre-existing Failures

Context: `CI=1 bun run test:e2e` was run on Windows with fresh E2E ports. Result: 68 tests total, 48 passed, 3 flaky, 17 failed. `bun run test:e2e -- fcm` passes by itself (3 passed), and `bun run test:e2e -- smoke` passes by itself (3 passed). The failures below are outside FCM token registration / fanout / unregister assertions.

Mechanical spec changes in this ticket are limited to `http://127.0.0.1:3001` -> `API_BASE` / `TEST_API_BASE` so mock E2E can avoid user-owned 3001/5173 processes. No assertion body was changed in the failing specs.

| Spec / test | Failure | 判定 |
|---|---|---|
| `auto-merge.spec.ts` / `Pipeline autoMerge=true:全 ticket done → state ready 後 backend 自動 append merge ticket` | `mergeAppended=false` after polling | Pre-existing auto-merge/mock-runner behavior. Spec only changed hard-coded API URL to `API_BASE`; no FCM code path. Last related commits: `1334d32`, `78934f2`. |
| `guards.spec.ts` / `PUT non-existent pipeline → 404` | expected 404, got 400 | Pre-existing route/validation behavior in pipeline save guard. Spec only changed hard-coded API URL to `API_BASE`; no FCM code path. |
| `merge-prune.spec.ts` / `DELETE pipeline:任何 state 都 prune worktree(含 merged)` | worktree `built=false` | Pre-existing Windows filesystem/mock runner failure. WebServer logs show `EPERM: operation not permitted, rename ... pipelines/*.json.tmp -> *.json`; unrelated to FCM. |
| `merge-prune.spec.ts` / `Reset all + Run:已 prune 過的 pipeline 再跑時 worktree 自動重建` | worktree `rebuilt=false` | Same Windows `EPERM rename` / mock-runner persistence issue; unrelated to FCM. |
| `merge.spec.ts` / `squash merge:全 ticket done + ready → POST /merge → state=merged + mergeCommit` | merge 409: target repo has untracked `.vibe-pipeline/` | Pre-existing merge cleanliness guard / fixture mismatch. FCM does not touch merge route or git state checks. |
| `merge.spec.ts` / `merge 完 base 真的有那個 commit` | `thing.ts` missing on `main` | Follows failed merge path above; unrelated to FCM. |
| `runner-edge.spec.ts` / `ticket finalStatus=failed_iter_limit → ticket 顯示 iter 上限狀態` | UI never shows `繼續` | Pre-existing runner/UI state issue; mock runner state mutation is also affected by Windows `EPERM rename`, and FCM only observes ticket completion for push. |
| `runner-edge.spec.ts` / `merged pipeline 不准 Run → state guard 擋` | returns `[mock runner] no script...` instead of merged guard | Pre-existing guard ordering in mock runner path; no FCM code path. |
| `notif.spec.ts` / `初始 inbox 是 collapsed strip,unreadCount=0` | `.inbox-strip-count` not found | Pre-existing UI selector/DOM drift. Spec was not changed by this ticket. |
| `notif.spec.ts` / `跑完 pipeline → emit pipeline_ready_to_merge → strip 顯示 unread` | `.inbox-strip-count.has-unread` not found | Pre-existing notification UI/mock-runner flow; WebServer logs include Windows `EPERM rename`. Spec was not changed by this ticket. |
| `notif.spec.ts` / `展開 inbox panel → 看到 notif 列表 → mark-all-read 清空 unread` | unread count never appears | Same pre-existing notification UI/mock-runner failure; not FCM. |
| `notif.spec.ts` / `inbox filter:unread / blocking 切換` | unread/filter UI never reaches expected state | Same pre-existing notification UI/mock-runner failure; not FCM. |
| `pipeline-crud.spec.ts` / `delete pipeline 從 overflow menu → 確認 → Rail 消失` | strict locator resolves both TopBar and pipeline overflow buttons | Pre-existing selector ambiguity after TopBar overflow UI. Spec was not changed by this ticket. |
| `runner-flow.spec.ts` / `step ticket Run → running → done → ready,commit hash 寫回` | runner state never reaches expected ready/done | Pre-existing mock-runner persistence issue; WebServer logs show Windows `EPERM rename`. Spec was not changed by this ticket. |
| `runner-flow.spec.ts` / `iter mode FAIL → PASS chain,verdicts 顯示` | runner state/verdicts never reach expected UI | Same pre-existing mock-runner persistence issue; not FCM. |
| `ticket-drawer.spec.ts` / `點 ticket → drawer 開啟,goal/acceptance/prompt 各欄位顯示` | drawer field locator not found | Pre-existing UI selector/DOM drift. Spec was not changed by this ticket. |
| `ticket-drawer.spec.ts` / `done ticket 顯示「重開 ticket」操作按鈕` | reset action locator not found | Pre-existing UI selector/DOM drift. Spec was not changed by this ticket. |

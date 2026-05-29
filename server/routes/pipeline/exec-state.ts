import * as orchestrator from '../../lib/runner/orchestrator';
import { ok, withPipeline } from '../_http';

// GET pipeline 執行態 — orchestrator in-memory state(running / queued / queuePosition)。
// CLI 是獨立 process,那 Map 永遠空,所以執行態查詢必須走 backend HTTP(設計信條 #6:
// ground truth 由 backend 驗)。前端用 pipeline list/runtime 即可,本端點專供 CLI status。
export async function pipelineExecState(hash: string, pipelineId: string): Promise<Response> {
  return withPipeline(hash, pipelineId, async () => {
    const running = orchestrator.isRunning(hash, pipelineId);
    const queued = orchestrator.isQueued(hash, pipelineId);
    const queuePosition = queued ? orchestrator.queuePosition(hash, pipelineId) : null;
    return ok({ running, queued, queuePosition });
  }, { requireInit: false });
}

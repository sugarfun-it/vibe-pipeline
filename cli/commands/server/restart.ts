import { isJsonMode, okJson, print } from "../../lib/output";
import { serverStart } from "./start";
import { serverStopForRestart } from "./stop";

export async function serverRestart(): Promise<void> {
  const stopped = await serverStopForRestart();
  const started = await serverStart({ quiet: true });
  if (isJsonMode()) {
    okJson({ restarted: true, stopped, started });
    return;
  }
  print("已重啟");
}

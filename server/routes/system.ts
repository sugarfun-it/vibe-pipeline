import { ok, err } from "./_http";
import { getVersionStatus } from "../lib/systemVersion";

export async function version(): Promise<Response> {
  try {
    const status = await getVersionStatus();
    return ok(status);
  } catch (e) {
    return err("internal_error", String(e), 500);
  }
}

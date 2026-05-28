import * as userConfig from "../lib/domain/userConfig";
import { UserConfigPatchError } from "../lib/domain/userConfig";
import { requireJsonUtf8, ok, err, readJson } from "./_http";
import type { ApiErrorCode } from "../../shared/types";

export async function getConfig(): Promise<Response> {
  const cfg = await userConfig.loadUserConfig();
  return ok(cfg);
}

export async function updateConfig(req: Request): Promise<Response> {
  const guardErr = requireJsonUtf8(req);
  if (guardErr) return guardErr;
  const body = await readJson(req);
  try {
    const next = await userConfig.patchUserConfig(body);
    return ok(next);
  } catch (e) {
    if (e instanceof UserConfigPatchError) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "invalid_path" satisfies ApiErrorCode,
            message: e.message,
            field: e.field,
          },
        },
        { status: 400 }
      );
    }
    return err("internal_error", String(e), 500);
  }
}

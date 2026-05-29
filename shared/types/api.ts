// ─── API envelope ─────────────────────────────────────────────────
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: ApiErrorCode; message: string } };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export type ApiErrorCode =
  | "not_found"
  | "permission_denied"
  | "dialog_cancelled"
  | "invalid_path"
  | "not_initialized"
  | "already_initialized"
  | "state_guard"
  | "working_tree_dirty"
  | "budget_exceeded"
  | "not_merged"
  | "internal_error";

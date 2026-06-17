import type { ModelCatalog } from "../../shared/types";
import { call } from "./_client";

export function getCatalog(): Promise<ModelCatalog> {
  return call<ModelCatalog>("/api/catalog");
}

import { getCatalog } from "../lib/domain/modelCatalog";
import { ok } from "./_http";

export async function getCatalogRoute(): Promise<Response> {
  return ok(getCatalog());
}

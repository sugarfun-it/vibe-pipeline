import { useEffect, useState } from "react";
import { BUNDLED_CATALOG, type ModelCatalog, type Provider } from "../../../shared/types";
import { getCatalog } from "../../api/catalog";

export function useModelCatalog() {
  const [cat, setCat] = useState<ModelCatalog>(BUNDLED_CATALOG);
  useEffect(() => {
    let alive = true;
    getCatalog()
      .then((c) => {
        if (alive) setCat(c);
      })
      .catch(() => {
        // fetch 失敗 → 維持 bundled
      });
    return () => {
      alive = false;
    };
  }, []);
  return {
    models: (p: Provider): readonly string[] => cat.models[p] ?? BUNDLED_CATALOG.models[p],
    efforts: (p: Provider): readonly string[] => cat.efforts[p] ?? BUNDLED_CATALOG.efforts[p],
  };
}

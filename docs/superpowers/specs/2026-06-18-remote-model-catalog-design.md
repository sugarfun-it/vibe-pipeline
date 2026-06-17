# 遠端 model/effort catalog

## 問題

可選的 model / effort 清單 hardcode 在 [`shared/types/user.ts`](../../../shared/types/user.ts) 的 `MODELS_BY_PROVIDER` / `EFFORTS_BY_PROVIDER`,被三處 build-time 引用:前端 `AITab.tsx` 下拉、CLI `config.ts`、backend 驗證與預設解析。每次 Claude / Codex 出新 model,maintainer 都要改 code → 發版 → enduser `vbpl update` 才選得到。

## 目標

把 model / effort 清單搬到 maintainer public repo 的一份 JSON,各 enduser backend 透過 HTTP GET 取得。新 model 出現只需編 JSON + `git push` main,**零發版、零 reinstall、零 backend restart**。

非目標:遠端控制各 task class 的預設 model 組合(`DEFAULT_USER_CONFIG` 維持 bundled);model 顯示 label / 描述(沿用 raw id 直顯)。

## 資料來源

URL hardcode,pin 在 `main`(不綁 release tag,使 catalog 更新獨立於發版):

```
https://raw.githubusercontent.com/sugarfun-it/vibe-pipeline/main/catalog/models.json
```

JSON shape(對齊現行慣例,每 array `[0]` = 該 provider 預設):

```json
{
  "version": "2026-06-18",
  "models":  { "claude": ["claude-opus-4-8", "claude-opus-4-7", "..."],
               "codex":  ["gpt-5.5", "gpt-5.4", "..."] },
  "efforts": { "claude": ["low", "medium", "high", "..."],
               "codex":  ["minimal", "low", "medium", "high"] }
}
```

- `version` 為 ISO date 字串,當 catalog 更新戳記(人看 / log 用,不做語意比對)。
- model id 為各 provider CLI 認得的原生字串(claude 全名 `claude-opus-4-8`;codex OpenAI 命名 `gpt-5.5`),原封傳給 `claude --model <id>` / codex `-c model=<id>`,不轉換。

repo 內檔案路徑:`catalog/models.json`。初版內容用現行 `shared/types/user.ts` 的 const 值搬過去。

## 元件

### 載入器 `server/lib/domain/modelCatalog.ts`

backend 與 CLI 共用(CLI 直存 fs、不發 HTTP,所以載入器必須能純讀檔)。

- **三層 fallback**:live fetch → 本地快取檔 → bundled 預設(`shared/types/user.ts` 現有 const 保留為最終保底)。
- **快取**:`~/.vibe-pipeline/models-catalog.json` 存 catalog 內容 + meta(`fetchedAt`, `etag`),atomic write(`.tmp` → rename)。
- **TTL 6h**:backend 觸發網路 refresh —— 開機一次 + 過期 lazy refresh(下次讀取時若 `now - fetchedAt > TTL` 背景重抓);帶 `If-None-Match` ETag,304 只更新 `fetchedAt`。
- **網路 fetch 僅 backend 觸發**;CLI 只讀快取檔(沒檔 → bundled),離線完全不卡。
- **shape 驗證**:欄位缺 / 型別錯 / 空 array → 視為失敗,退回快取或 bundled,壞 JSON 不砸 picker。fetch timeout(如 5s)亦退回。
- 對外 API:`getModels(provider)` / `getEfforts(provider)` / `getDefaultModel(provider)` —— 取代 `shared` 的 `modelsForProvider` 等純函式在 backend/CLI 側的角色。

### 出口

- **新 API** `GET /api/catalog` → `{ models, efforts }`(backend 回 modelCatalog 當前值;含 `version`)。
- **前端** `AITab.tsx`:改 fetch `/api/catalog` 渲染下拉;載入中先用 bundled const 當 placeholder,到貨即換。新增 `src/api/catalog.ts` + 對應 hook。
- **CLI** `cli/commands/config.ts`:改讀 modelCatalog 載入器(快取檔),不再直引 const。
- **backend 驗證**:`isValidModel` / `getResolvedDefaults` 等改問 modelCatalog,不再直引 const。

## 資料流

```
maintainer 編 catalog/models.json → git push main
          ↓ (raw.githubusercontent.com, CDN ~5min)
enduser backend 開機 / TTL 過期 → fetch → 驗證 → 寫快取檔
          ↓
GET /api/catalog ← 前端 AITab 下拉
modelCatalog.get* ← backend 驗證 / CLI config(讀快取檔)
          ↓ fallback 任一層失敗
本地快取檔 → bundled const(shared/types/user.ts)
```

## 錯誤處理

- 網路失敗 / timeout / 非 200(非 304)/ 壞 shape → 不 throw,靜默退回快取或 bundled;backend log warn 一行。
- 快取檔毀損 → 當無快取,退 bundled。
- `/api/catalog` 任何情況都回得出值(最差是 bundled),前端不需處理「catalog 不存在」。

## 信任邊界

enduser fetch 的是 maintainer 自己的 public repo `main`,URL hardcode,與 push gateway 同信任模型。JSON 無 secret,只有 model id 字串(會餵給 CLI `--model`)。不接受任意第三方 URL override(避免被導去惡意 catalog);若 forker 要換,改 build-time const / env，不走 runtime 輸入。

## 測試

- 載入器單元:三層 fallback 各路徑(live ok / 304 / 壞 shape / timeout / 無快取 / 快取毀損)。
- shape 驗證:缺欄位 / 空 array / 型別錯 → 退 fallback。
- `GET /api/catalog`:有快取回快取、無快取回 bundled。
- 前端:載入中顯 bundled、到貨換遠端(e2e 可 mock `/api/catalog`)。
- CLI `config`:離線(無快取)時用 bundled 不報錯。

# Enduser install + update 設計

## 動機

VP 要支援 enduser(非 maintainer)裝法:install script 解 tarball 到 `~/.vibe-pipeline/app/`,**不 clone repo,沒 `.git/`**。原 backend update flow 走 `git pull + bun install + bun run build`,enduser 環境用不到。

## 決議

- **install location 固定 `~/.vibe-pipeline/app/`** — enduser 機器上 backend 永遠從這裡跑。
- **update 永遠下載 tarball** — `/api/system/update` 走 GitHub release(`releases/latest`),不再有 git pull / rebuild 分支。
- **純前進,不 rollback** — 解壓失敗 / 中斷 → `~/.vibe-pipeline/app/` 可能半套,user 重跑 install script 即修。不留 backup dir,降低狀態機複雜度。
- **dev clone 永遠不被碰** — 從 `~/code/vibe-pipeline/`(或任何 dev clone)按更新按鈕,backend 也是去 download tarball 蓋 `~/.vibe-pipeline/app/`,並從那裡 spawn 新 backend。dev source tree 一個 byte 都不會被動到。

## Backend update flow(`server/lib/updater.ts`)

1. **preflightCheck** — 兩條任一失敗就 400:
   - 沒 pipeline running(`orchestrator.globalRunningCount() === 0`)
   - 有新 release(`getVersionStatus().hasUpdate`)
   - **git clean 檢查已拔** — enduser app dir 沒 `.git/`,沒意義
2. **fetchReleaseInfo** — GET `https://api.github.com/repos/<repo>/releases/latest`:
   - 優先 release `assets[]` 內 `.tar.gz` / `.tgz` / `.zip`(maintainer 上傳的打平 bundle)
   - fallback `tarball_url`(GitHub 自動產的源 tarball,解壓有一層 `owner-repo-<sha>/`,程式自動 strip)
3. **下載 → `~/.vibe-pipeline/app.download.tmp/<filename>`**
4. **解壓 → `~/.vibe-pipeline/app.staging/`**
   - `.tar.gz` / `.tgz` → `tar -xzf`
   - `.zip` Windows → PowerShell `Expand-Archive`;POSIX → `tar -xf`(bsdtar / GNU tar 新版)
   - 解完若只有一個 top-level dir,視為 root(配合 GitHub source tarball)
5. **rm `~/.vibe-pipeline/app/` → mv staging root → `~/.vibe-pipeline/app/`** — 純前進
6. **cleanup** download.tmp / staging
7. **spawnNewBackend** — `Bun.spawn(["bun","run","server/index.ts"], { cwd: appDir, detached:true, stdio:ignore, windowsHide:true })`
8. **舊 backend 500ms 後 `process.exit(0)`** — response 已先回 client,gap 期間 `/api/health` 503 由 frontend poll retry

全程 log append 到 `~/.vibe-pipeline/update.log`(truncate 模式,每次 update 覆蓋)。

## Frontend(`UpdateTab`)

不變 — `triggerSystemUpdate()` 收 `{ started: true, newVersion?: string }`,UI 顯「更新中,稍候自動重啟」,health poll 等 backend 回來。新 frontend bundle 被 Workbox 偵測為新版,`<SwUpdateBanner>` 提示 reload。

## Dev 怎麼驗 update flow

dev 在 `~/code/vibe-pipeline/`(或本 worktree)按「套用更新」**會去蓋 `~/.vibe-pipeline/app/`**,然後新 backend 從 app dir 起,舊 backend 退出。dev source 不變,但下次 dev 啟動 backend 走的是 dev cwd,跟 update 出來的 app dir 各自獨立。

要驗完整 enduser flow:

1. 另開一個 enduser-style 安裝(跑 install script 把 tarball 解到 `~/.vibe-pipeline/app/`)
2. 直接 `cd ~/.vibe-pipeline/app && bun run server/index.ts` 跑該安裝的 backend
3. 在該 backend 上按「套用更新」驗 download → extract → 新 backend spawn → 舊 exit 全段
4. 驗完想清掉:`rm -rf ~/.vibe-pipeline/app/`(注意:state.json / worktrees/ 不在 app/ 內,不會被砍)

dev 機器本身的 `~/.vibe-pipeline/` runtime data(`state.json` / `worktrees/` / `auth.json` / `gateway-token` …)**跟 `app/` 平級且獨立**,不會被 update 影響。

## 不在本次 scope

- install script 本體(release tarball 打包流程、shell installer)
- release CI(`bun run build` + tar.gz 上傳成 release asset 的 workflow)
- vbpl CLI 從 `~/.vibe-pipeline/bin/vbpl` 取 binary 的散布管道(舊 updater 會 cp `vbpl.exe` 到 `bin/`,新 flow 假設 tarball 內已含 binary 或 user 走 PATH 解法)

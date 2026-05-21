---
description: 推 GitHub release vX.Y.Z — build tarball + move tag to HEAD + upload asset + sync release notes(自動 create or update)
argument-hint: <version> 例 `0.2.0` 或 `v0.2.0`
---

# /release — VP GitHub release ship

用法:`/release 0.2.0`(自動補 `v` 變 `v0.2.0`)

前置條件:
- `docs/release/v<VERSION>.md` 已寫好 release notes
- working tree clean(無 uncommitted)— 不然 build-tarball 會把未 commit 改動偷進去

## 執行

`$1` 是 user 給的 version,以下 bash 統一從 `$1` 抓並正規化 `v` 前綴。

1. **pre-flight 檢查**(任一不過直接 abort):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$1"
   VERSION="v${RAW#v}"
   echo "VERSION=$VERSION"

   # release notes 存在?
   if [ ! -f "docs/release/$VERSION.md" ]; then
     echo "❌ docs/release/$VERSION.md 不存在,先寫 release notes"
     exit 1
   fi

   # working tree clean?
   if [ -n "$(git status --porcelain)" ]; then
     echo "❌ working tree 不乾淨(下面是未 commit 變動):"
     git status --short
     echo "先 commit / stash 再 release(/acp 直接收尾)"
     exit 1
   fi

   echo "✅ pre-flight 過"
   ```

2. **push 任何未 push 的 commits 到 origin/main**(release 必須跟 main 對齊):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   git push origin main 2>&1
   ```

3. **build tarball**(預期 ~800KB-1MB,失敗 abort):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$1"
   VERSION="v${RAW#v}"
   bun run scripts/build-tarball.ts $VERSION 2>&1 | tail -8
   ls -la vibe-pipeline-$VERSION.tar.gz 2>&1
   ```
   沒看到 `Done. Tarball:` 或 tarball file → 排雷,別繼續。

4. **move tag to HEAD + force push tag**(consolidate 模式:tag 永遠指 latest HEAD):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$1"
   VERSION="v${RAW#v}"
   git tag -d $VERSION 2>&1 || true
   git tag $VERSION HEAD
   git show --no-patch --format="%h %s" $VERSION
   git push origin $VERSION --force 2>&1
   ```

5. **upload tarball + sync release notes**(自動偵測 release 是否已存在):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$1"
   VERSION="v${RAW#v}"
   if gh release view $VERSION >/dev/null 2>&1; then
     echo "=== release $VERSION 已存在 — clobber asset + update notes ==="
     gh release upload $VERSION vibe-pipeline-$VERSION.tar.gz --clobber 2>&1
     gh release edit $VERSION --notes-file docs/release/$VERSION.md 2>&1
   else
     echo "=== release $VERSION 是新的 — create ==="
     gh release create $VERSION --notes-file docs/release/$VERSION.md vibe-pipeline-$VERSION.tar.gz 2>&1
   fi
   ```

6. **cleanup 本地 tarball**:
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$1"
   VERSION="v${RAW#v}"
   rm -f vibe-pipeline-$VERSION.tar.gz
   ls vibe-pipeline-$VERSION.tar.gz 2>&1 || echo "cleaned"
   ```

7. **verify**(enduser 視角從 GitHub API 拉 latest release):
   ```bash
   RAW="$1"
   VERSION="v${RAW#v}"
   curl -s "https://api.github.com/repos/eric14304/vibe-pipeline/releases/latest" | python -c "
   import json,sys
   d = json.load(sys.stdin)
   print(f\"latest tag:  {d['tag_name']}\")
   print(f\"published:   {d['published_at']}\")
   for a in d['assets']:
     print(f\"asset:       {a['name']} ({a['size']} bytes)\")
   import sys; sys.exit(0 if d['tag_name'] == '$VERSION' else 1)
   "
   ```
   斷言:`latest tag` 必須 = `$VERSION`,exit 0。不對 → 排雷(release 沒推上去 / API cache?)。

## 報告

- pushed commits 數(從 step 2 output)
- tarball size(step 3)
- release URL:`https://github.com/eric14304/vibe-pipeline/releases/tag/<VERSION>`
- enduser 取新版:`vbpl update`(CLI)或 PWA Settings →「套用更新」

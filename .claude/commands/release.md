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

`$ARGUMENTS` 是 user 給的 version,以下 bash 統一從 `$ARGUMENTS` 抓並正規化 `v` 前綴。

1. **pre-flight 檢查**(任一不過直接 abort):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$ARGUMENTS"
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

2. **bump `package.json` version 對齊**(`build-tarball.ts` 有 arg vs package.json 一致檢查;不一致時自動 bump + commit):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$ARGUMENTS"
   VERSION="v${RAW#v}"
   TARGET="${RAW#v}"
   CURRENT=$(python -c "import json;print(json.load(open('package.json'))['version'])")
   if [ "$CURRENT" = "$TARGET" ]; then
     echo "✅ package.json 已是 $TARGET,不必 bump"
   else
     echo "package.json $CURRENT → $TARGET,bump + commit"
     python -c "
import json
p = json.load(open('package.json'))
p['version'] = '$TARGET'
with open('package.json','w',encoding='utf-8') as f:
  json.dump(p, f, indent=2, ensure_ascii=False)
  f.write('\n')
"
     git add package.json
     git commit -m "chore(release): bump version $CURRENT → $TARGET" 2>&1
   fi
   ```

3. **push 任何未 push 的 commits 到 origin/main**(release 必須跟 main 對齊;若上一步有 bump commit 也一起推):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   git push origin main 2>&1
   ```

4. **build tarball**(預期 ~800KB-1MB,失敗 abort):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$ARGUMENTS"
   VERSION="v${RAW#v}"
   bun run scripts/build-tarball.ts $VERSION 2>&1 | tail -8
   ls -la vibe-pipeline-$VERSION.tar.gz 2>&1
   ```
   沒看到 `Done. Tarball:` 或 tarball file → 排雷,別繼續。

5. **move tag to HEAD + force push tag**(consolidate 模式:tag 永遠指 latest HEAD):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$ARGUMENTS"
   VERSION="v${RAW#v}"
   git tag -d $VERSION 2>&1 || true
   git tag $VERSION HEAD
   git show --no-patch --format="%h %s" $VERSION
   git push origin $VERSION --force 2>&1
   ```

6. **upload tarball + sync release notes**(自動偵測 release 是否已存在):
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$ARGUMENTS"
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

7. **cleanup 本地 tarball**:
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   RAW="$ARGUMENTS"
   VERSION="v${RAW#v}"
   rm -f vibe-pipeline-$VERSION.tar.gz
   ls vibe-pipeline-$VERSION.tar.gz 2>&1 || echo "cleaned"
   ```

8. **verify**(enduser 視角從 GitHub API 拉 latest release):
   ```bash
   RAW="$ARGUMENTS"
   VERSION="v${RAW#v}"
   curl -s "https://api.github.com/repos/sugarfun-it/vibe-pipeline/releases/latest" | python -c "
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

- bump commit hash(若 step 2 真有 bump)
- pushed commits 數(從 step 3 output)
- tarball size(step 4)
- release URL:`https://github.com/sugarfun-it/vibe-pipeline/releases/tag/<VERSION>`
- enduser 取新版:`vbpl update`(CLI)或 PWA Settings →「套用更新」

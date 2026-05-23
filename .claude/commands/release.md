---
description: 推 GitHub release vX.Y.Z — build tarball + move tag to HEAD + upload asset + sync release notes(自動 create or update)
argument-hint: <version> 例 `0.2.0` 或 `v0.2.0`
---

# /release — VP GitHub release ship

`/release 0.2.0`(自動補 `v`)。Tag 永遠指 HEAD(consolidate 模式)。

前置:`docs/release/v<VERSION>.md` 寫好;working tree clean。

## 執行

```bash
cd "$(git rev-parse --show-toplevel)"
VERSION="v${ARGUMENTS#v}"
TARGET="${VERSION#v}"

# 1. pre-flight
[ -f "docs/release/$VERSION.md" ] || { echo "❌ docs/release/$VERSION.md 不存在"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "❌ tree 不乾淨,先 commit / stash"; git status --short; exit 1; }

# 2. package.json 對齊(build-tarball 有 arg vs version 一致檢查)
CURRENT=$(python -c "import json;print(json.load(open('package.json'))['version'])")
if [ "$CURRENT" != "$TARGET" ]; then
  python -c "import json;p=json.load(open('package.json'));p['version']='$TARGET';open('package.json','w',encoding='utf-8').write(json.dumps(p,indent=2,ensure_ascii=False)+'\n')"
  git add package.json && git commit -m "chore(release): bump $CURRENT → $TARGET"
fi

# 3. push main
git push origin main

# 4. build tarball
bun run scripts/build-tarball.ts $VERSION 2>&1 | tail -5
ls -la vibe-pipeline-$VERSION.tar.gz || { echo "❌ build fail"; exit 1; }

# 5. tag move + force push
git tag -d $VERSION 2>/dev/null
git tag $VERSION HEAD
git push origin $VERSION --force

# 6. upload + sync notes
if gh release view $VERSION >/dev/null 2>&1; then
  gh release upload $VERSION vibe-pipeline-$VERSION.tar.gz --clobber
  gh release edit $VERSION --notes-file docs/release/$VERSION.md
else
  gh release create $VERSION --notes-file docs/release/$VERSION.md vibe-pipeline-$VERSION.tar.gz
fi

# 7. cleanup
rm -f vibe-pipeline-$VERSION.tar.gz

# 8. verify enduser visibility
curl -s "https://api.github.com/repos/sugarfun-it/vibe-pipeline/releases/latest" | python -c "
import json,sys
d=json.load(sys.stdin); print(f\"tag={d['tag_name']} published={d['published_at']}\")
for a in d['assets']: print(f\"asset {a['name']} {a['size']}B\")
sys.exit(0 if d['tag_name']=='$VERSION' else 1)
"
```

## 報告

- bump hash(若有)+ tarball size + release URL = `https://github.com/sugarfun-it/vibe-pipeline/releases/tag/$VERSION`
- enduser 取新版:`vbpl update` 或 PWA Settings →「套用更新」

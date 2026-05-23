---
description: 推 GitHub release vX.Y.Z — build tarball + move tag to HEAD + upload asset + sync release notes(自動 create or update)
argument-hint: <version> 例 `0.2.0` 或 `v0.2.0`
---

# /release — VP GitHub release ship

`/release 0.2.0`(自動補 `v`)。Tag 永遠指 HEAD(consolidate 模式)。

前置:`docs/release/v<VERSION>.md` 寫好(規範見下);working tree clean。

## Release notes 撰寫規範

target user = enduser(裝 vbpl 的人),**不是** maintainer。寫的人(AI / 你)看完這段再下筆。

### 結構(固定三段)

```markdown
## Highlights
- **<一句話 user-visible 改動>** — 一行說明影響。
- **<另一條>** — ...

## Fix(若 release 主要是 bug fix)/ Feature(新功能)/ <領域>(視內容開節)
### <短標題>
1-3 句說 user 怎麼踩、修法摘要(不貼 code,不講 design rationale)。

## 升級
\`\`\`bash
vbpl update
# 或 PWA Settings → 「套用更新」
\`\`\`
```

### 禁寫

- Maintainer-only flow(release 流程、tag 策略、gateway redeploy 紀錄、build-tarball 內部)
- Deep rationale / 設計信條對齊 / 雷區 walkthrough(那些去 commit / CHANGELOG / SKILL.md)
- 完整 code block 跟堆砌 diff(超過 5 行就拆 link 出去)
- 「砍了 N 行死碼 / N 個檔重構」這種 maintainer 指標(enduser 不在意,放 commit msg)
- Token / class / 設計系統內部命名(`--radius-control`、`.vp-chip` 等;只在影響 enduser 行為時提)

### 可寫

- 一句話 highlights(每個 ≤ 25 字),user 一眼看到「我為什麼要升」
- bug fix:症狀 + 一句修法(symptoms-first,user 認得症狀就升)
- feature:新指令 / 新 UI 入口 / 行為改變
- 升級步驟(永遠就這 4 行)

### 大小參考

| 類型 | 目標大小 |
|---|---|
| hotfix(v0.2.1 型) | < 600B / < 20 行 |
| 一般 fix(v0.2.3 型) | < 1.5KB / < 40 行 |
| 大改(v0.2.4 UI overhaul 型) | < 3.5KB / < 70 行 |

超出就再砍。不確定砍哪 → 砍 maintainer 視角 / 砍 rationale / 砍 code block。



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

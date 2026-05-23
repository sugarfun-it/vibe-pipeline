---
description: 推 GitHub release vX.Y.Z — build tarball + move tag to HEAD + upload asset + sync release notes(自動 create or update)。支援 fake-local 模式給 maintainer 測 PWA 更新動線。
argument-hint: <version> 例 `0.2.0` 或 `v0.2.0`;或 `<ship-version> fake <local-version>` 例 `0.2.4 fake 0.2.0`
---

# /release — VP GitHub release ship

`/release 0.2.0`(自動補 `v`)。Tag 永遠指 HEAD(consolidate 模式)。

前置:`docs/release/v<VERSION>.md` 寫好(規範見下);working tree clean。

## Fake-local 模式(`<ship> fake <local>`)

`/release 0.2.4 fake 0.2.0` = **正常發 v0.2.4(tarball 內就是真 0.2.4)** + **裝完之後把本機 `~/.vibe-pipeline/current/package.json` 版本改成 0.2.0 並 restart backend**。

用途:maintainer 在自己機器上製造「本機 < GH latest」假狀態,PWA update banner 會跳,可以走完整 update flow:點「套用更新」→ 真.下載 v0.2.4 tarball → 裝完 backend 報 v0.2.4 → banner 消失。

- ship 版本 = GH release tag / asset 檔名 / tarball 內 `package.json.version` / docs `docs/release/v<ship>.md`(全部一致,**沒造假**)
- fake-local 是 ship 完之後的本機 side effect:patch `~/.vibe-pipeline/current/package.json` + `vbpl server restart`。完全不動 GH 上的東西。
- 副作用:測完跑一次 `vbpl update`(或 PWA「套用更新」)就會把本機 package.json 蓋回正常。沒清理也不會影響別人 ── 只有自己這台機器顯版本怪。

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

# 0. 解析 args:支援 "<ship>" 或 "<ship> fake <local>"
read -r SHIP_RAW REST <<< "$ARGUMENTS"
VERSION="v${SHIP_RAW#v}"
TARGET="${VERSION#v}"
FAKE_LOCAL=""
if [[ "$REST" =~ ^fake[[:space:]]+([0-9vV.]+)$ ]]; then
  FAKE_LOCAL="${BASH_REMATCH[1]#v}"
  echo "⚠ fake-local 模式:ship=$VERSION 本機裝完會被改回 $FAKE_LOCAL 並 restart backend"
fi

# 1. pre-flight
[ -f "docs/release/$VERSION.md" ] || { echo "❌ docs/release/$VERSION.md 不存在"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "❌ tree 不乾淨,先 commit / stash"; git status --short; exit 1; }

# 2. package.json 對齊 ship
CURRENT=$(python -c "import json;print(json.load(open('package.json'))['version'])")
if [ "$CURRENT" != "$TARGET" ]; then
  python -c "import json;p=json.load(open('package.json'));p['version']='$TARGET';open('package.json','w',encoding='utf-8').write(json.dumps(p,indent=2,ensure_ascii=False)+'\n')"
  git add package.json && git commit -m "chore(release): bump $CURRENT → $TARGET"
fi

# 3. push main
git push origin main

# 4. build tarball(永遠走正常 ship build,fake-local 不影響 tarball)
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

# 9. fake-local(only if fake mode):patch ~/.vibe-pipeline/current/package.json + restart
if [ -n "$FAKE_LOCAL" ]; then
  LOCAL_PKG="$HOME/.vibe-pipeline/current/package.json"
  [ -f "$LOCAL_PKG" ] || { echo "⚠ 本機沒裝(找不到 $LOCAL_PKG),fake-local 跳過"; exit 0; }
  python -c "
import json
p=json.load(open('$LOCAL_PKG'))
p['version']='$FAKE_LOCAL'
open('$LOCAL_PKG','w',encoding='utf-8').write(json.dumps(p,indent=2,ensure_ascii=False)+'\n')
print(f'[fake-local] $LOCAL_PKG → $FAKE_LOCAL')
"
  vbpl server restart 2>&1 | tail -3
  echo "✓ 本機 backend restart 完。PWA 開起來會看到「目前版本 $FAKE_LOCAL」< latest $VERSION,update banner 會跳。"
fi
```

## 報告

- bump hash(若有)+ tarball size + release URL = `https://github.com/sugarfun-it/vibe-pipeline/releases/tag/$VERSION`
- enduser 取新版:`vbpl update` 或 PWA Settings →「套用更新」

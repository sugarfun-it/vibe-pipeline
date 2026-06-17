---
description: 推 GitHub release vX.Y.Z — build tarball + move tag to HEAD + upload asset + sync release notes(自動 create or update)。支援 fake-local 模式給 maintainer 測 PWA 更新動線。
argument-hint: <version> 例 `0.2.0` 或 `v0.2.0`;或 `<ship-version> fake <local-version>` 例 `0.2.4 fake 0.2.0`
---

# /release — VP GitHub release ship

`/release 0.2.0`(自動補 `v`)。Tag 永遠指 HEAD(consolidate 模式)。**Release 標題永遠 = 版號**(`v0.2.0`),不加描述/副標 — 描述全進 release notes(`docs/release/v<VERSION>.md`),標題保持乾淨可掃。

前置:`docs/release/v<VERSION>.md` 寫好(規範見下);working tree clean。

## Fake-local 模式(`<ship> fake <local>`)

`/release 0.2.4 fake 0.2.0` = **正常發 v0.2.4(tarball 內就是真 0.2.4)** + **裝完之後把本機 `~/.vibe-pipeline/current/package.json` 版本改成 0.2.0 並 restart backend**。

用途:maintainer 在自己機器上製造「本機 < GH latest」假狀態,PWA update banner 會跳,可以走完整 update flow:點「套用更新」→ 真.下載 v0.2.4 tarball → 裝完 backend 報 v0.2.4 → banner 消失。

- ship 版本 = GH release tag / asset 檔名 / tarball 內 `package.json.version` / docs `docs/release/v<ship>.md`(全部一致,**沒造假**)
- fake-local 是 ship 完之後的本機 side effect:patch `~/.vibe-pipeline/current/package.json` + `vbpl server restart`。完全不動 GH 上的東西。
- 副作用:測完跑一次 `vbpl update`(或 PWA「套用更新」)就會把本機 package.json 蓋回正常。沒清理也不會影響別人 ── 只有自己這台機器顯版本怪。

## Release notes 撰寫規範

target user = enduser(裝 vbpl 的人),**不是** maintainer。寫的人(AI / 你)看完這段再下筆。

行業參考(短 / 動詞起手 / user-visible only):Stripe、Linear、Vercel、Anthropic API、Tailwind major releases。對標的反例是 GitHub 自動生成 PR list(細到無法判斷要不要升)+ 自家 v0.2.4(把 maintainer CHANGELOG 當 release notes 發)。

### 口吻 — 寫給「裝了 vbpl 的朋友看」

像跟朋友講「新版做了什麼」,不是寫 PR description / commit message。**白話、口語、直接**。

| 改前(工程術語 ❌) | 改後(白話 ✓) |
|---|---|
| Fix push notification token registration regression | 推播壞了,現在會收到通知 |
| Backend `EADDRINUSE` auto-fallback | port 3001 被別的程式佔到時,backend 會自己換一個 port 起來 |
| 設計系統收斂 / 視覺一致性提升 | 按鈕、邊框、顏色長得比較整齊 |
| 重構 backend 模組,降低耦合 | (刪掉。user 看不到差別) |
| Sticky footer + iter chip / merged mode | ticket drawer 底下按鈕固定不滑走 |
| Implements iter-uiux based UI consolidation | UI 改得比較好看 |

英文專有名詞(`port` / `cache` / `token` / `backend` / `PWA`)留著 OK ── user 平常就這樣講。但避免 `regression` / `fallback chain` / `idempotent` / `landmark` 這種沒在日常對話用的字。

### 核心測試 — 寫完先問自己 4 句

1. **「user 5 秒讀完 Highlights,能說出『我為什麼要升』嗎?」** 不能 → 重寫
2. **「整份有沒有任何句子是給 maintainer 看的?」** 有 → 刪
3. **「拿掉就少資訊嗎?」** 不少 → 刪
4. **「念出來像跟朋友講話嗎?還是像在念 commit message?」** 後者 → 改白話

### 結構(固定三段,不開新 ## 區段)

```markdown
## Highlights
- **<動詞起手:修了 / 加了 / 改了 / 砍了 ___>** — 一句說 user 行為差別。
- **<另一條>** — ...

## Fix / Feature(只開一節,選對應的;**不再開 ## Tokens / ## Primitives 之類 maintainer 區段**)
1-3 句寫 user 怎麼踩 → 一句修法摘要。

## 升級
\`\`\`bash
vbpl update
# 或 PWA Settings → 「套用更新」
\`\`\`
```

**Highlights 上限 3-5 條**。超過代表沒收斂 user-visible 結論。每條 ≤ 30 字。run-on 用 `/` 串多個技術點 = 沒挑重點。

### 禁寫(grep 自我檢查;命中就刪重寫)

- Maintainer flow:release 步驟 / tag 策略 / gateway redeploy / build-tarball 內部 / package.json bump
- Deep rationale / 設計信條 / 雷區 walkthrough → 那些去 commit / CHANGELOG / SKILL.md
- 完整 code block 跟堆砌 diff(超過 5 行就 link 出去)
- **「N 行 / N 處 / N 個檔 / N 個 unit / N 個 token」這種計數指標**(enduser 不在意 effort / scope)
- **內部 toolchain 名詞**:codex / iter-uiux / playwright / parallel sub-agent / advisor-reviewer 等
- **File path / 變數名 / class 名 / token 名**(`server/index.ts`、`Bun.serve`、`.vp-chip`、`--radius-control`、`gatewayUrl()` ── enduser 看不懂)
- **內部 taxonomy**:primitive / landmark / token / overlay contract / per-unit rebuild ── 換成 user 詞彙(按鈕 / 標題 / 對話框)
- **`## Backlog` / `## 刻意 defer` / `## Tradeoffs`** ── release notes 寫**有發的**,不寫沒發的
- 「視覺更一致」「設計系統收斂」「重構」「瘦身」 ── 抽象用語,user 認不出對應行為差別

### 句型對照(改寫前後)

| 改前(❌) | 改後(✓) |
|---|---|
| UI/UX 大改 — 設計系統收斂(tokens / chip / button / overlay / focus-ring)... | 拿掉了「按鈕 hover 突然變色」「drawer 邊角圓不一致」等視覺雜訊 |
| 重構大瘦身:3 條主檔從 1100/950/1460 行 → 890/180/120 | (刪掉。enduser 看不到行數) |
| `server/index.ts` `Bun.serve` 包 try/catch,`EADDRINUSE` 改 `port: 0` | port 3001 被佔時 backend 自動改用閒置 port,不再 crash |
| 透過 15 個 UI unit 的 parallel codex-supervised iter loop | (刪掉 toolchain 細節。看效果不看流程) |
| 新增 canonical token:`--radius-control/card/panel`、`--control-h`... | (整段刪。token 是 internal,user 看到的是「圓角統一」) |

### 大小上限(超過硬砍,不留情)

| 類型 | 上限 | 範例 |
|---|---|---|
| hotfix | **< 500B / 15 行** | v0.2.1 |
| 一般 fix | **< 1KB / 25 行** | v0.2.3 |
| 大改(含 feature + UI overhaul) | **< 2KB / 40 行** | v0.2.4 應該是 — 實際 3.5KB 已超 |

**超過就砍**,不要妥協。砍順序:maintainer 視角 → rationale → file path / 變數名 → 計數指標 → toolchain 名詞 → 抽象形容詞。

超過 40 行還砍不掉 = 把 CHANGELOG 寫進來了。回頭只留 user 行為差別。



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
# 標題永遠 = 版號($VERSION),不加任何描述(--title 顯式鎖死,別讓 gh 用 notes 首行當標題)
if gh release view $VERSION >/dev/null 2>&1; then
  gh release upload $VERSION vibe-pipeline-$VERSION.tar.gz --clobber
  gh release edit $VERSION --title "$VERSION" --notes-file docs/release/$VERSION.md
else
  gh release create $VERSION --title "$VERSION" --notes-file docs/release/$VERSION.md vibe-pipeline-$VERSION.tar.gz
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

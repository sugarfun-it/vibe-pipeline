import { join, dirname } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { projectHash } from "../hash";
import { vibeHome } from "../paths";
import { runCapture } from "../childSpawn";
import type { DiffStat, DiffFile, FullDiff, CommitRef } from "../../../../shared/types";
export type { DiffStat, DiffFile, FullDiff };

function worktreeRoot(): string {
  return join(vibeHome(), ".vibe-pipeline", "worktrees");
}

export function worktreePath(projectPath: string, pipelineId: string): string {
  return join(worktreeRoot(), projectHash(projectPath), pipelineId);
}

export function exists(projectPath: string, pipelineId: string): boolean {
  return existsSync(worktreePath(projectPath, pipelineId));
}

async function spawnGit(args: string[], cwd?: string): Promise<{ ok: boolean; out: string; err: string }> {
  const r = await runCapture(["git", ...args], { cwd });
  return { ok: r.ok, out: r.out.trim(), err: r.err.trim() };
}

// 建/重用 worktree。已存在直接回 path,沒有就 add。
// branch 不存在 → -b 建新 branch from baseBranch;branch 存在 → checkout 到該 branch
// add 成功後跑一次 .worktreeinclude copy(只在新建那次,resume 不重複)。
export async function ensure(
  projectPath: string,
  pipelineId: string,
  branchName: string,
  baseBranch: string
): Promise<string> {
  const wt = worktreePath(projectPath, pipelineId);
  if (existsSync(wt)) {
    // 只看 dir 在不在不夠:上次 git worktree add 半途失敗 / 主 repo 做過 git 手術 / 被 prune
    // 掉註冊但 dir 殘留 → dir 在但不是健康 worktree(無有效 .git)。直接回收會讓 sub-agent
    // 在非 repo 目錄裡跑、自刻 stub 取代真 repo 檔、git -C 全 fail → commitTicket 0-commit。
    // 驗 rev-parse 確認健康;壞了就 rm -rf + prune 失效註冊,fall through 重 add。
    const healthy = await spawnGit(["rev-parse", "--is-inside-work-tree"], wt);
    if (healthy.ok && healthy.out.trim() === "true") return wt;
    try {
      rmSync(wt, { recursive: true, force: true });
    } catch {
      // 被 lock 擋住也續走 — git worktree add 撞既有 dir 會自己報錯,不會默默壞
    }
    await spawnGit(["worktree", "prune"], projectPath);
  }

  mkdirSync(join(worktreeRoot(), projectHash(projectPath)), { recursive: true });

  // Check if branch already exists
  const branchCheck = await spawnGit(
    ["rev-parse", "--verify", "--quiet", branchName],
    projectPath
  );
  const branchExists = branchCheck.ok;

  const args = ["worktree", "add"];
  if (!branchExists) args.push("-b", branchName);
  args.push(wt);
  if (!branchExists) args.push(baseBranch);
  else args.push(branchName);

  const res = await spawnGit(args, projectPath);
  if (!res.ok) {
    throw new Error(`git worktree add failed: ${res.err || res.out}`);
  }

  await copyWorktreeIncludes(projectPath, wt);
  return wt;
}

// 讀 <projectPath>/.worktreeinclude,把列出的 gitignored 檔複製進新 worktree。
// git worktree add 只帶 tracked 檔,.env 等 gitignored 憑證不會進 worktree → AI 找不到會 hardcode。
// 慣例對齊 Claude Code 的 .worktreeinclude:.gitignore 語法,只複製「match pattern 且本身被 gitignore」的檔
// (tracked 檔被 git check-ignore 過濾掉,不會重複複製)。
// best-effort:複製失敗不 throw,worktree 本身已建好,copy 只是加分。
async function copyWorktreeIncludes(projectPath: string, wt: string): Promise<void> {
  // base 預設:鏡像所有 gitignored 檔(.env / 憑證 / 本地 config),但**跳過 ignored 目錄**
  // → node_modules / dist / .next / build 等大目錄自動不帶。讓 worktree 是可跑驗證的環境,
  // sub-agent 不必逃去 main repo 跑 DB 測試(踩過:executor 改在 main、工作沒進 branch、靜默丟)。
  // `ls-files -o -i --exclude-standard --directory` 把整個被 ignore 的目錄收斂成單一 "dir/" entry,
  // 只 copy 檔、跳目錄。不靠 user 填 .worktreeinclude(那份常留範本全註解狀態)。
  // ponytail: 要帶某個 ignored *目錄*(node_modules 等)→ 寫進 .worktreeinclude,下面 glob 那段處理。
  try {
    const ig = await spawnGit(["ls-files", "-o", "-i", "--exclude-standard", "--directory"], projectPath);
    if (ig.ok) {
      for (const rel of ig.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        if (rel.endsWith("/")) continue; // ignored 目錄 → 跳
        const dst = join(wt, rel);
        if (existsSync(dst)) continue;
        mkdirSync(dirname(dst), { recursive: true });
        await Bun.write(dst, Bun.file(join(projectPath, rel)));
      }
    }
  } catch {
    // best-effort
  }
  // .worktreeinclude 額外帶(base 沒涵蓋的:ignored 目錄內容、或自訂 pattern)
  try {
    const wtiPath = join(projectPath, ".worktreeinclude");
    if (!existsSync(wtiPath)) return;
    const content = await Bun.file(wtiPath).text();
    const patterns = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    for (const pat of patterns) {
      // 目錄 pattern(尾 /)→ 展成遞迴 glob;其餘原樣
      const globPat = pat.endsWith("/") ? pat + "**" : pat;
      const glob = new Bun.Glob(globPat);
      for await (const rel of glob.scan({ cwd: projectPath, dot: true, onlyFiles: true })) {
        // 確認該檔真的被 gitignore — tracked 檔(check-ignore exit 1)直接跳過,維持安全性質
        const ci = await spawnGit(["check-ignore", "-q", rel], projectPath);
        if (!ci.ok) continue;
        const src = join(projectPath, rel);
        const dst = join(wt, rel);
        mkdirSync(dirname(dst), { recursive: true });
        await Bun.write(dst, Bun.file(src));
      }
    }
  } catch {
    // best-effort:吞掉。worktree 已建好,缺 .env 的話 runner prompt 防禦條會擋(AI 不該 hardcode)
  }
}

export async function remove(projectPath: string, pipelineId: string): Promise<void> {
  const wt = worktreePath(projectPath, pipelineId);
  if (!existsSync(wt)) return;
  const res = await spawnGit(["worktree", "remove", "--force", wt], projectPath);
  if (!res.ok) {
    throw new Error(`git worktree remove failed: ${res.err || res.out}`);
  }
}

export async function prune(projectPath: string): Promise<void> {
  await spawnGit(["worktree", "prune"], projectPath);
}

// Throw-safe 版本:remove worktree(git worktree remove --force → 移除實體 dir → 失敗 fallback prune)。
// merge / delete 完成後呼叫,讓 caller 不必擔心 worktree dir 已被外部刪 / git metadata 損壞等情況。
// 永遠不 throw;回 { ok, error } 給 caller 決定要不要降級為 warning。
export async function removeQuiet(
  projectPath: string,
  pipelineId: string
): Promise<{ ok: boolean; error?: string }> {
  const wt = worktreePath(projectPath, pipelineId);
  try {
    // 1. git worktree remove(若 dir 還在 git 註冊表)
    if (existsSync(wt)) {
      const res = await spawnGit(["worktree", "remove", "--force", wt], projectPath);
      if (!res.ok) {
        // remove 失敗常見:dir 已被外部刪掉 / locked / metadata 壞掉 / 孤兒(git 不認)→ 走 fallback
        // 試著手動刪 dir + prune,把 git 註冊表清掉
        try {
          if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
        } catch {
          // 可能被 Windows file lock 擋掉 — 下面複驗會抓到
        }
        const pruneRes = await spawnGit(["worktree", "prune"], projectPath);
        // ground truth(信條 #6):prune 成功 ≠ dir 真的刪了。rmSync 被 file lock 擋掉、
        // 或孤兒 dir(prune 根本碰不到)時,dir 仍在。複驗 existsSync,還在就回 ok:false,
        // 別假陽性報「已清」(否則 cleanup toast 顯成功但磁碟資料夾還在)。
        if (existsSync(wt)) {
          return {
            ok: false,
            error: `worktree dir 仍存在,清不掉(file lock / 孤兒?):remove=${res.err || res.out}`,
          };
        }
        if (!pruneRes.ok) {
          return {
            ok: false,
            error: `worktree remove + prune 都失敗:remove=${res.err || res.out};prune=${pruneRes.err || pruneRes.out}`,
          };
        }
        // remove 失敗但 dir 已清掉 + prune 救回 — 視為成功
        return { ok: true };
      }
      // remove 成功;若 dir 仍殘留(極少數)手動清,並複驗確認真的不在
      if (existsSync(wt)) {
        try {
          rmSync(wt, { recursive: true, force: true });
        } catch {
          // ignore — 複驗會抓
        }
        if (existsSync(wt)) {
          return { ok: false, error: "git worktree remove 回成功但 dir 仍殘留,清不掉(file lock?)" };
        }
      }
      return { ok: true };
    }
    // dir 不存在 → 只需 prune 清 git 註冊表(若有殘留紀錄)
    await spawnGit(["worktree", "prune"], projectPath);
    return { ok: true };
  } catch (e) {
    // 兜底:任何例外都當失敗回去,不要 throw
    return { ok: false, error: String(e) };
  }
}

// 看當下 worktree 跟 base 的 diff stat(已 commit + working tree 都算)。
// 給 UI polling 顯示「+N -M / K files」用,讓 user 知道 runner 正在改東西。
// 沒 worktree / git 異常 → 回 null,UI 隱藏即可。
export async function diffStat(
  projectPath: string,
  pipelineId: string,
  baseBranch: string
): Promise<DiffStat | null> {
  const wt = worktreePath(projectPath, pipelineId);
  if (!existsSync(wt)) return null;
  // --shortstat:" 12 files changed, 234 insertions(+), 45 deletions(-)"
  // 有可能 0 deletion → 沒那段;也可能 0 file → 整行空。
  // 比 baseBranch (no triple-dot) → working tree 對 base 的所有差異(含 uncommit)。
  const res = await spawnGit(["diff", "--shortstat", baseBranch], wt);
  if (!res.ok) return null;
  return parseShortstat(res.out);
}

function parseShortstat(s: string): DiffStat {
  const files = /(\d+) files? changed/.exec(s)?.[1];
  const added = /(\d+) insertions?\(\+\)/.exec(s)?.[1];
  const deleted = /(\d+) deletions?\(-\)/.exec(s)?.[1];
  return {
    files: files ? Number(files) : 0,
    added: added ? Number(added) : 0,
    deleted: deleted ? Number(deleted) : 0,
  };
}

// 看 worktree 上 branch 落後 base 幾個 commit(從 base merge-base 算起 base 多走的 commit 數)。
// 用 rev-list --count baseBranch ^HEAD(只在 baseBranch 上 reachable 的 commit,而 worktree HEAD 還沒拿到的)。
// 沒 worktree / git 異常 → 回 null,UI 自己處理。
export async function behindBaseCount(
  projectPath: string,
  pipelineId: string,
  baseBranch: string
): Promise<number | null> {
  const wt = worktreePath(projectPath, pipelineId);
  if (!existsSync(wt)) return null;
  const res = await spawnGit(["rev-list", "--count", `HEAD..${baseBranch}`], wt);
  if (!res.ok) return null;
  const n = Number(res.out.trim());
  return Number.isFinite(n) ? n : null;
}

// 嘗試在 worktree 上 git merge base branch。
// 回:
//   { ok: true, alreadyUpToDate: true } → base 沒新東西
//   { ok: true, commit } → merge 成功(fast-forward 或 clean 3-way),commit hash 是 merge commit(ff 時是 base HEAD)
//   { ok: false, conflictFiles } → 有衝突,worktree 留在 conflict 狀態(caller 決定要 abort 還是進 AI 流程)
//   { ok: false, error } → 其他失敗(worktree 不存在 / git error etc),也回乾淨狀態(成功 abort)
export async function mergeFromBase(
  projectPath: string,
  pipelineId: string,
  baseBranch: string
): Promise<
  | { ok: true; alreadyUpToDate: true }
  | { ok: true; alreadyUpToDate?: false; commit: CommitRef }
  | { ok: false; conflictFiles: string[] }
  | { ok: false; error: string }
> {
  const wt = worktreePath(projectPath, pipelineId);
  if (!existsSync(wt)) return { ok: false, error: "worktree 不存在" };

  // 先確認 worktree 乾淨,否則 git merge 會吃掉 user 未 commit 的改動
  const dirty = await spawnGit(["status", "--porcelain"], wt);
  if (!dirty.ok) return { ok: false, error: `git status 失敗:${dirty.err}` };
  if (dirty.out.trim().length > 0) {
    return { ok: false, error: "worktree 有未 commit 的改動,先 commit 或 stash 再 sync" };
  }

  // 取 baseBranch 最新(從 main repo fetch / pull origin 並非這層責任 — 上層若要更新 base 自己處理)
  // 我們只 merge 本地 baseBranch 進 worktree branch
  const baseHead = await spawnGit(["rev-parse", baseBranch], wt);
  if (!baseHead.ok) return { ok: false, error: `找不到 base branch ${baseBranch}:${baseHead.err}` };

  const myHead = await spawnGit(["rev-parse", "HEAD"], wt);
  if (!myHead.ok) return { ok: false, error: `worktree HEAD 異常:${myHead.err}` };

  // base merge-base == base HEAD 表示 worktree 已 contain base(沒落後)
  const mergeBase = await spawnGit(["merge-base", "HEAD", baseBranch], wt);
  if (mergeBase.ok && mergeBase.out.trim() === baseHead.out.trim()) {
    return { ok: true, alreadyUpToDate: true };
  }

  // 跑 merge — --no-ff 永遠建 merge commit(timeline 清楚 base 何時被 pull 進來)
  const mergeMsg = `sync: merge ${baseBranch} into pipeline branch`;
  const mergeRes = await spawnGit(
    ["merge", "--no-ff", "-m", mergeMsg, baseBranch],
    wt
  );

  if (mergeRes.ok) {
    const commitRes = await spawnGit(["rev-parse", "HEAD"], wt);
    const subjectRes = await spawnGit(["log", "-1", "--format=%s"], wt);
    return {
      ok: true,
      commit: {
        hash: commitRes.out.trim(),
        subject: subjectRes.out.trim() || mergeMsg,
        ts: Date.now(),
      },
    };
  }

  // merge 失敗:多半是衝突。撈衝突檔案
  const status = await spawnGit(["status", "--porcelain"], wt);
  const conflictFiles = status.ok
    ? status.out
        .split(/\r?\n/)
        .filter((l) => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(l))
        .map((l) => l.replace(/^..\s+/, ""))
    : [];
  if (conflictFiles.length > 0) {
    return { ok: false, conflictFiles };
  }
  // 沒衝突卻 merge 失敗 — 其他原因(detached HEAD / git config 問題等)。讓 caller 看 err
  return { ok: false, error: mergeRes.err || mergeRes.out || "merge failed" };
}

// 中止當前 worktree 上進行中的 merge(把 worktree 回到 merge 前狀態,丟掉 conflict markers)
// 對 ai_running 取消 / failed 收尾用
export async function mergeAbort(
  projectPath: string,
  pipelineId: string
): Promise<{ ok: boolean; error?: string }> {
  const wt = worktreePath(projectPath, pipelineId);
  if (!existsSync(wt)) return { ok: false, error: "worktree 不存在" };
  const res = await spawnGit(["merge", "--abort"], wt);
  if (!res.ok) {
    // 沒在 merge 中時 abort 會失敗,當成已乾淨即可
    if (/no merge to abort/i.test(res.err)) return { ok: true };
    return { ok: false, error: res.err || res.out };
  }
  return { ok: true };
}

// 完整 unified diff:跟 base 比對 worktree 全部改動。
// 回 { files: [{path, added, deleted}], raw } — raw 是 git diff 全文,前端自己 render。
export async function fullDiff(
  projectPath: string,
  pipelineId: string,
  baseBranch: string
): Promise<FullDiff | null> {
  const wt = worktreePath(projectPath, pipelineId);
  if (!existsSync(wt)) return null;
  // numstat 給檔案級加減行數;raw diff 給前端整段顯示
  const stat = await spawnGit(["diff", "--numstat", baseBranch], wt);
  const raw = await spawnGit(["diff", baseBranch], wt);
  if (!stat.ok || !raw.ok) return null;
  const files: DiffFile[] = stat.out
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      // numstat 格式:"<added>\t<deleted>\t<path>" — binary file 時 added/deleted 會是 "-"
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      const a = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
      const d = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
      return { path: parts.slice(2).join("\t"), added: a, deleted: d };
    })
    .filter((f): f is DiffFile => f !== null);
  return { files, raw: raw.out };
}

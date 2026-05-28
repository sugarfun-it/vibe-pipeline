import { homedir } from "node:os";

// 解 user home 走這個 wrapper,不要直接 homedir(),這樣 e2e 可以靠 VP_HOME_OVERRIDE 把 ~/.vibe-pipeline/ 導到 tmpdir
// 不污染 user 真 state(state.json / worktrees/)。
//
// real 模式不設此 env,行為跟以前一樣。
export function vibeHome(): string {
  const override = process.env.VP_HOME_OVERRIDE;
  if (override && override.length > 0) return override;
  return homedir();
}

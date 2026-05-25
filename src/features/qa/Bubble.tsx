export function ThinkingDots() {
  // 外層 "AI 思考中" 容器自己有 role=status,這裡的點點純裝飾,避免雙重宣告
  return (
    <span className="qadr-thinking-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function Bubble({ kind, message }: { kind: "user" | "ai"; message: string }) {
  return (
    <div className={"qadr-bubble qadr-bubble-" + kind}>
      <div className="qadr-bubble-role mono">{kind === "user" ? "你" : "助理"}</div>
      <div className="qadr-bubble-msg">{message}</div>
    </div>
  );
}

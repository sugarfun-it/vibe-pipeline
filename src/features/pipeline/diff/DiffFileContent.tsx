import type { Ref } from "react";
import { markerFor, parseDiffByFile, slug, srLabelFor, stripLeadSign } from "./diffHelpers";

type DiffFileContentProps = {
  raw: string;
  contentRef: Ref<HTMLDivElement>;
};

export function DiffFileContent({ raw, contentRef }: DiffFileContentProps) {
  return (
    <div className="diff-modal-content mono" ref={contentRef}>
      {parseDiffByFile(raw).map((block) => (
        <div
          key={block.path}
          id={`diff-file-${slug(block.path)}`}
          className="diff-modal-file-block"
        >
          <div className="diff-modal-file-header">{block.path}</div>
          <pre className="diff-modal-pre">
            {block.lines.map((l, i) => (
              // append-only diff lines,內容會重複(空行 / context),index 是 stable 正確 key
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only diff lines
              <span key={i} className={"diff-line is-" + l.kind}>
                {/* SR-only label:add/del/hunk 行為 SR 朗讀 "新增" / "刪除" / "區塊";
                    否則 stripLeadSign 把 +/- 拿掉後,SR 只聽到 code,失去 add/del 訊號 */}
                {(l.kind === "add" || l.kind === "del" || l.kind === "hunk") && (
                  <span className="sr-only">{srLabelFor(l.kind)}</span>
                )}
                <span className="diff-line-marker" aria-hidden>{markerFor(l.kind)}</span>
                <span className="diff-line-text">{stripLeadSign(l.kind, l.text)}</span>
              </span>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}

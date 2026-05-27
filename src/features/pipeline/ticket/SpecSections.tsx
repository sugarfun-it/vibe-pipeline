import { CollapsiblePrompt, Section } from "./TicketDrawerParts";

export function SpecSections({
  goal,
  acceptance,
  prompt,
  isDone,
}: {
  goal?: string;
  acceptance?: string[];
  prompt?: string;
  isDone: boolean;
}) {
  return (
    <>
      <Section label="目標">
        {goal ? (
          <CollapsiblePrompt text={goal} defaultCollapsed={isDone} label="目標" />
        ) : (
          <span className="tdrw-empty">(空)</span>
        )}
      </Section>
      <Section label="驗收">
        {Array.isArray(acceptance) && acceptance.length > 0 ? (
          <CollapsiblePrompt
            text={acceptance.join("\n\n")}
            defaultCollapsed={isDone}
            label="驗收"
          />
        ) : (
          <span className="tdrw-empty">(空)</span>
        )}
      </Section>
      <Section label="提示詞">
        {prompt ? (
          <CollapsiblePrompt text={prompt} defaultCollapsed={isDone} label="提示詞" />
        ) : (
          <span className="tdrw-empty">(空)</span>
        )}
      </Section>
    </>
  );
}

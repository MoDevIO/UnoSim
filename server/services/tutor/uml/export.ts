import type {
  UmlActivityStep,
  UmlClassProposal,
  UmlSequenceProposal,
  ValidUmlProposal,
} from "@shared/tutor-uml";
/** Every syntax/Creole-significant character is a Unicode literal, never a directive. */
function literalCharacter(char: string): string {
  if (/[\p{L}\p{N} ]/u.test(char)) return char;
  if (char === "\n") return String.raw`\n`;
  return `<U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}>`;
}
function literal(value: string): string {
  return [...value].map(literalCharacter).join("");
}
const preamble = [
  "@startuml",
  "!pragma layout smetana",
  "skinparam backgroundColor #FFFFFF",
  "skinparam defaultFontName DejaVu Sans",
  "skinparam defaultFontSize 14",
  "skinparam shadowing false",
  "skinparam monochrome true",
  "skinparam classBackgroundColor #FFFFFF",
  "skinparam participantBackgroundColor #FFFFFF",
];
function activity(steps: readonly UmlActivityStep[]): string[] {
  return steps.flatMap((step) => {
    if (step.type === "action") return [`:${literal(step.code)};`];
    if (step.type === "decision")
      return [
        `if (${literal(step.condition)}) then ([ja])`,
        ...activity(step.whenTrue),
        "else ([nein])",
        ...activity(step.whenFalse),
        "endif",
      ];
    return [
      `while (${literal(step.condition)}) is ([ja])`,
      ...activity(step.body),
      "endwhile ([nein])",
    ];
  });
}
function activityDiagram(
  proposal: Extract<ValidUmlProposal, { kind: "activity" }>,
): string[] {
  const output = [
    "skinparam conditionEndStyle diamond",
    "skinparam conditionStyle InsideDiamond",
    "skinparam activityBackgroundColor #FFFFFF",
    "skinparam activityBorderColor #202020",
    "start",
  ];
  if ("runtime" in proposal)
    output.push(
      "title Ausschnitt: Arduino setup/loop",
      `:${literal("setup()")};`,
      ...activity(proposal.setup.body),
      "repeat",
      `:${literal("loop()")};`,
      ...activity(proposal.loop.body),
      "repeat while (true) is ([immer])",
      "detach",
    );
  else output.push(...activity(proposal.body), "stop");
  return output;
}
function visibility(value: string): string {
  if (value === "public") return "+";
  return value === "private" ? "-" : "#";
}
function classDiagram(proposal: UmlClassProposal): string[] {
  const output = ["skinparam classAttributeIconSize 0", "hide circle"];
  const ids = new Map(
    proposal.classes.map((c, index) => [c.name, `C${index}`]),
  );
  for (const klass of proposal.classes) {
    output.push(`class "${literal(klass.name)}" as ${ids.get(klass.name)} {`);
    for (const member of klass.members.filter((m) => m.kind === "attribute"))
      output.push(
        ` ${visibility(member.visibility)}${literal(member.declaration)}`,
      );
    output.push("--");
    for (const member of klass.members.filter((m) => m.kind === "operation"))
      output.push(
        ` ${visibility(member.visibility)}${literal(member.declaration)}`,
      );
    output.push("}");
  }
  for (const relation of proposal.relations)
    output.push(
      relation.kind === "generalization"
        ? `${ids.get(relation.to)} <|-- ${ids.get(relation.from)}`
        : `${ids.get(relation.from)} -- ${ids.get(relation.to)} : Attributtyp`,
    );
  return output;
}
function participantLabel(
  participant: UmlSequenceProposal["participants"][number],
): string {
  return participant.kind === "object"
    ? `${participant.name} : ${participant.className}`
    : `${participant.name} (Ausführungskontext)`;
}
function sequenceDiagram(proposal: UmlSequenceProposal): string[] {
  const output = ["skinparam style strictuml", "hide footbox"];
  const ids = new Map(
    proposal.participants.map((p, index) => [p.name, `P${index}`]),
  );
  for (const participant of proposal.participants)
    output.push(
      `participant "${literal(participantLabel(participant))}" as ${ids.get(participant.name)}`,
    );
  for (const message of proposal.messages)
    output.push(
      `${ids.get(message.from)} ${message.type === "call" ? "->" : "-->"} ${ids.get(message.to)} : ${literal(message.code)}`,
    );
  return output;
}
/** Closed templates: the validated proposal contributes text only, never PlantUML statements or IDs. */
export function exportTutorUml(proposal: ValidUmlProposal): string {
  let content: string[];
  if (proposal.kind === "activity") content = activityDiagram(proposal);
  else if (proposal.kind === "class") content = classDiagram(proposal);
  else content = sequenceDiagram(proposal);
  return [...preamble, ...content, "@enduml"].join("\n");
}

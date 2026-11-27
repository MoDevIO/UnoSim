import type {
  UmlActivityStep,
  UmlClassProposal,
  UmlExcerptActivityProposal,
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
/**
 * UML notation: the decision node stays empty, each outgoing edge carries its guard in brackets, and the
 * edge taken otherwise is `[sonst]`. Both edges rejoin in a merge node. A decision is a two-case `switch`:
 * unlike `if`, it gives an empty branch its own column, so no guard is drawn across the other branch's edge.
 * In an excerpt a return leaves the function: its path ends in a final node, and as `switch` would still
 * draw a merge node with a single incoming edge there, such a decision is an `if`.
 */
const isReturn = (step: UmlActivityStep): boolean => step.type === "action" && /^return\b/.test(step.code.trim());
function containsReturn(steps: readonly UmlActivityStep[]): boolean {
  return steps.some((step) => {
    if (step.type === "action") return isReturn(step);
    return step.type === "decision" ? containsReturn(step.whenTrue) || containsReturn(step.whenFalse) : containsReturn(step.body);
  });
}
/** Whether a path through `steps` can reach their end, i.e. not every path leaves by a return. */
function reachesEnd(steps: readonly UmlActivityStep[]): boolean {
  return steps.every((step) => {
    if (step.type === "decision") return reachesEnd(step.whenTrue) || reachesEnd(step.whenFalse);
    return !isReturn(step);
  });
}
function activity(steps: readonly UmlActivityStep[], excerpt = false): string[] {
  return steps.flatMap((step) => {
    if (step.type === "action")
      // In an excerpt a return leaves the enclosing function: its path ends here and does not join the others.
      return excerpt && isReturn(step)
        ? [`:${literal(step.code)};`, "stop"]
        : [`:${literal(step.code)};`];
    if (step.type === "decision" && excerpt && !(reachesEnd(step.whenTrue) && reachesEnd(step.whenFalse)))
      return [
        `if () then ([${literal(step.condition)}])`,
        ...activity(step.whenTrue, excerpt),
        "else ([sonst])",
        ...activity(step.whenFalse, excerpt),
        "endif",
      ];
    if (step.type === "decision")
      return [
        "switch ()",
        `case ([${literal(step.condition)}])`,
        ...activity(step.whenTrue, excerpt),
        "case ([sonst])",
        ...activity(step.whenFalse, excerpt),
        "endswitch",
      ];
    return [
      `while () is ([${literal(step.condition)}])`,
      ...activity(step.body, excerpt),
      "endwhile ([sonst])",
    ];
  });
}
const lines = ({ startLine, endLine }: { readonly startLine: number; readonly endLine: number }): string =>
  startLine === endLine ? `Zeile ${startLine}` : `Zeilen ${startLine} bis ${endLine}`;
/** The regular path of an excerpt goes on after its last line: a connector, not the program's end. */
function goesOn(proposal: UmlExcerptActivityProposal): string[] {
  const note = literal(`weiter nach Zeile ${proposal.scope.endLine}`);
  return ["(A)", `note right: ${note}`, "detach"];
}
/**
 * The way back leaves the decision to the right, carrying its guard, and turns up in the middle of its node;
 * a node narrower than twice the guard would turn up through the guard's text. Invisible no-break spaces at
 * the end of its last line widen it (in characters, the measure the layout's font roughly keeps).
 */
function wideEnough(text: string, guard: string): string {
  const lines = text.split("\n");
  const needed = 2 * (guard.length + 2) + 8;
  const widest = Math.max(...lines.map((line) => line.length));
  return widest >= needed ? text : text + "\u00A0".repeat(needed - (lines.at(-1)?.length ?? 0));
}
/**
 * A decision directly in `loop()` with one branch of plain actions ending in `return` (a guard clause): the
 * return starts the next pass, which sets the condition's variables again, so that branch leads back up to
 * the statements that set them, through a merge node before them. The decision is the loop's own condition
 * node, so no node without a choice is drawn; PlantUML allows a single node on that way back, which holds
 * the whole branch. Line numbers stand in notes. Undefined for any other excerpt.
 */
function loopBack(proposal: UmlExcerptActivityProposal): string[] | undefined {
  const [decision, ...rest] = proposal.body;
  if (!proposal.enclosing || rest.length > 0 || decision?.type !== "decision") return undefined;
  const branches = [
    [decision.whenTrue, decision.whenFalse, decision.condition, "sonst"],
    [decision.whenFalse, decision.whenTrue, "sonst", decision.condition],
  ] as const;
  for (const [back, onward, backGuard, onwardGuard] of branches) {
    const last = back.at(-1);
    const guardClause =
      last !== undefined && isReturn(last) && back.every((step) => step.type === "action") && !containsReturn(back.slice(0, -1));
    if (!guardClause || containsReturn(onward)) continue;
    return [
      "repeat",
      ...proposal.enclosing.inputs.flatMap((input) => [`:${literal(input.code)};`, `note right: ${literal(lines(input.ref))}`]),
      `backward :${literal(wideEnough(back.map((step) => (step.type === "action" ? step.code : "")).join("\n"), backGuard))};`,
      `repeat while () is ([${literal(backGuard)}]) not ([${literal(onwardGuard)}])`,
      ...activity(onward, true),
      ...goesOn(proposal),
    ];
  }
  return undefined;
}
function activityDiagram(
  proposal: Extract<ValidUmlProposal, { kind: "activity" }>,
): string[] {
  const output = [
    "skinparam conditionEndStyle diamond",
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
      "repeat while () is ([immer])",
      "detach",
    );
  else if ("excerpt" in proposal)
    output.push(
      `title ${proposal.excerpt === "statement-with-error" ? "Ausschnitt mit einem eingebauten Fehler" : "Ausschnitt"}: Zeilen ${proposal.scope.startLine} bis ${proposal.scope.endLine}`,
      // The excerpt is not the end of the program: its regular path leaves through a connector and goes on
      // after its last line. (An arrow label after `endswitch` is a PlantUML syntax error.) When every path
      // returns, none goes on.
      ...(loopBack(proposal) ?? [...activity(proposal.body, true), ...(reachesEnd(proposal.body) ? goesOn(proposal) : [])]),
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

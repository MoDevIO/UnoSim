import {
  tutorUmlProposalSchema,
  TUTOR_UML_LIMITS,
  type UmlCodeContext,
  type UmlDiagramProposal,
  type UmlValidation,
  type ValidUmlProposal,
  type UmlActivityStep,
  type UmlClassProposal,
  type UmlArduinoActivityProposal,
  type UmlSequenceProposal,
  type UmlSourceRef,
} from "@shared/tutor-uml";
import type { SyntaxNode } from "@lezer/common";
import {
  readUmlSources,
  hasArduinoRuntimeFacts,
  ARDUINO_UML_RUNTIME_FACTS,
  hasParticipantShadow,
  hasUnsupportedSequenceDefaults,
  children,
  classMembers,
  className,
  codeText,
  functionName,
  matchesRef,
  nodesNamed,
  normalizedCode,
  proveActivity,
  scopedFunction,
  straightStatements,
  type UmlSourceDocument,
} from "./source";
import { proveActivityExcerpt } from "./excerpt";

function nestedSteps(step: UmlActivityStep): UmlActivityStep[][] {
  if (step.type === "decision") return [step.whenTrue, step.whenFalse];
  return step.type === "loop" ? [step.body] : [];
}
function countSteps(steps: readonly UmlActivityStep[]): {
  nodes: number;
  edges: number;
} {
  return steps.reduce(
    (sum, step) => {
      const nested = nestedSteps(step).map(countSteps);
      return {
        nodes:
          sum.nodes +
          1 +
          (step.type === "decision" ? 1 : 0) +
          nested.reduce((n, s) => n + s.nodes, 0),
        edges:
          sum.edges +
          (step.type === "action" ? 1 : 3) +
          nested.reduce((n, s) => n + s.edges, 0),
      };
    },
    { nodes: 0, edges: 0 },
  );
}
function validSpan(
  docs: readonly UmlSourceDocument[],
  ref: UmlSourceRef,
): boolean {
  const doc = docs.find((d) => d.file === ref.file);
  return !!doc && ref.endLine <= doc.text.split("\n").length;
}
function proveClasses(
  proposal: UmlClassProposal,
  docs: readonly UmlSourceDocument[],
): boolean {
  const names = proposal.classes.map((c) => c.name);
  if (new Set(names).size !== names.length) return false;
  const found = new Map<string, { doc: UmlSourceDocument; node: SyntaxNode }>();
  for (const shown of proposal.classes) {
    if (
      shown.ref.file === proposal.scope.file &&
      (shown.ref.startLine < proposal.scope.startLine ||
        shown.ref.endLine > proposal.scope.endLine)
    )
      return false;
    const candidates = docs.flatMap((doc) =>
      nodesNamed(doc, "ClassSpecifier")
        .filter((node) => className(doc, node) === shown.name)
        .map((node) => ({ doc, node })),
    );
    if (candidates.length !== 1) return false;
    const { doc, node } = candidates[0];
    if (node.parent?.name !== "Program" || !matchesRef(doc, node, shown.ref))
      return false;
    const actual = classMembers(doc, node);
    const used = new Set<number>();
    for (const member of shown.members) {
      const matching = actual.filter(
        (m) =>
          m.declaration === normalizedCode(member.declaration) &&
          m.visibility === member.visibility &&
          m.kind === member.kind &&
          matchesRef(doc, m.node, member.ref),
      );
      if (matching.length !== 1 || used.has(matching[0].node.from))
        return false;
      used.add(matching[0].node.from);
    }
    found.set(shown.name, { doc, node });
  }
  return proposal.relations.every((relation) => {
    const from = found.get(relation.from),
      to = found.get(relation.to);
    if (!from || !to || relation.from === relation.to) return false;
    if (relation.kind === "generalization") {
      const base = children(from.node).find(
        (n) => n.name === "BaseClassClause",
      );
      if (!base || !matchesRef(from.doc, base, relation.ref)) return false;
      const types = children(base).filter((n) => n.name === "TypeIdentifier");
      return types.length === 1 && codeText(from.doc, types[0]) === relation.to;
    }
    return classMembers(from.doc, from.node).some(
      (member) =>
        member.kind === "attribute" &&
        matchesRef(from.doc, member.node, relation.ref) &&
        children(member.node).some(
          (n) =>
            n.name === "TypeIdentifier" &&
            codeText(from.doc, n) === relation.to,
        ),
    );
  });
}
interface SequenceEvent {
  type: "call" | "return";
  from: string;
  to: string;
  code: string;
  doc: UmlSourceDocument;
  node: SyntaxNode;
}
type SequenceParticipant = UmlSequenceProposal["participants"][number];
type SourceNode = { doc: UmlSourceDocument; node: SyntaxNode };
function proveParticipant(
  participant: SequenceParticipant,
  docs: readonly UmlSourceDocument[],
): boolean {
  if (participant.kind === "context") {
    const candidate = scopedFunction(docs, participant.ref);
    return (
      !!candidate &&
      functionName(candidate.doc, candidate.node) === participant.name &&
      candidate.node.parent?.name === "Program"
    );
  }
  // Comments, strings and local shadows never prove a global object.
  const declarations = docs.flatMap((doc) =>
    nodesNamed(doc, "Declaration")
      .filter((node) =>
        children(node).some(
          (n) =>
            n.name === "Identifier" && codeText(doc, n) === participant.name,
        ),
      )
      .map((node) => ({ doc, node })),
  );
  if (declarations.length !== 1) return false;
  const object = declarations[0];
  return (
    object.node.parent?.name === "Program" &&
    matchesRef(object.doc, object.node, participant.ref) &&
    children(object.node).some(
      (n) =>
        n.name === "TypeIdentifier" &&
        codeText(object.doc, n) === participant.className,
    )
  );
}
interface SequenceWalk {
  docs: readonly UmlSourceDocument[];
  participants: ReadonlyMap<string, SequenceParticipant>;
  events: SequenceEvent[];
  active: Set<SyntaxNode>;
}
function callDestination(
  doc: UmlSourceDocument,
  target: SyntaxNode,
  owner: string,
  participants: SequenceWalk["participants"],
): { receiver: string; method: string } | undefined {
  if (target.name === "FieldExpression") {
    const fields = children(target);
    if (
      fields.length !== 2 ||
      fields[0].name !== "Identifier" ||
      fields[1].name !== "FieldIdentifier"
    )
      return undefined;
    // Pointer dispatch and arbitrary expressions are deliberately unsupported.
    if (!/^\w+\s*\.\s*\w+$/.test(codeText(doc, target))) return undefined;
    return {
      receiver: codeText(doc, fields[0]),
      method: codeText(doc, fields[1]),
    };
  }
  if (target.name !== "Identifier") return undefined;
  const method = codeText(doc, target);
  return {
    receiver: participants.get(method)?.kind === "context" ? method : owner,
    method,
  };
}
function sequenceTargets(
  participant: SequenceParticipant,
  method: string,
  docs: readonly UmlSourceDocument[],
): SourceNode[] {
  if (participant.kind === "context") {
    const candidates = docs.flatMap((doc) =>
      doc.nodes
        .filter((node) =>
          ["FunctionDefinition", "Declaration"].includes(node.name) &&
          node.parent?.name === "Program" &&
          functionName(doc, node) === method,
        )
        .map((node) => ({ doc, node })),
    );
    // A visible declaration can supply defaults absent from the definition.
    if (candidates.some(({ doc, node }) => hasUnsupportedSequenceDefaults(doc, node)))
      return [];
    return candidates.filter(({ node }) => node.name === "FunctionDefinition");
  }
  const klass = docs.flatMap((doc) =>
    nodesNamed(doc, "ClassSpecifier")
      .filter((node) => className(doc, node) === participant.className)
      .map((node) => ({ doc, node })),
  );
  if (klass.length !== 1) return [];
  const { doc, node } = klass[0];
  // Both declarations and definitions count; overloaded methods are not resolved.
  const members = classMembers(doc, node).filter(
    (m) => m.kind === "operation" && functionName(doc, m.node) === method,
  );
  if (members.length !== 1 || hasUnsupportedSequenceDefaults(doc, members[0].node))
    return [];
  return members
    .filter((m) => m.node.name === "FunctionDefinition")
    .map((m) => ({ doc, node: m.node }));
}
function containsNestedCall(doc: UmlSourceDocument, node: SyntaxNode): boolean {
  return nodesNamed(doc, "CallExpression").some(
    (n) => n.from > node.from && n.to <= node.to,
  );
}
function recordSequenceCall(
  state: SequenceWalk,
  doc: UmlSourceDocument,
  statement: SyntaxNode,
  owner: string,
): boolean {
  const parts = children(statement);
  if (parts.length !== 1 || parts[0].name !== "CallExpression") return false;
  const call = parts[0];
  // Nested argument evaluation is deliberately not given an invented order.
  if (containsNestedCall(doc, call)) return false;
  const destination = callDestination(
    doc,
    children(call)[0],
    owner,
    state.participants,
  );
  if (!destination) return false;
  const { receiver, method } = destination;
  const participant = state.participants.get(receiver);
  if (!participant) return false;
  const targets = sequenceTargets(participant, method, state.docs);
  if (targets.length !== 1) return false;
  state.events.push({
    type: "call",
    from: owner,
    to: receiver,
    code: codeText(doc, call),
    doc,
    node: call,
  });
  return (
    walkSequence(state, targets[0].doc, targets[0].node, receiver, owner) &&
    state.events.length <= 48
  );
}
function recordSequenceReturn(
  state: SequenceWalk,
  doc: UmlSourceDocument,
  statement: SyntaxNode,
  owner: string,
  caller: string | undefined,
  terminal: boolean,
): boolean {
  if (!terminal || containsNestedCall(doc, statement)) return false;
  if (caller)
    state.events.push({
      type: "return",
      from: owner,
      to: caller,
      code: codeText(doc, statement),
      doc,
      node: statement,
    });
  return true;
}
function walkSequence(
  state: SequenceWalk,
  doc: UmlSourceDocument,
  fn: SyntaxNode,
  owner: string,
  caller?: string,
): boolean {
  if (state.active.has(fn) || state.active.size > 6) return false;
  state.active.add(fn);
  if (hasParticipantShadow(doc, fn, new Set(state.participants.keys())))
    return false;
  const statements = straightStatements(fn);
  if (!statements) return false;
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index];
    if (statement.name === "ReturnStatement") {
      if (
        !recordSequenceReturn(
          state,
          doc,
          statement,
          owner,
          caller,
          index === statements.length - 1,
        )
      )
        return false;
    } else if (!recordSequenceCall(state, doc, statement, owner)) return false;
  }
  state.active.delete(fn);
  return true;
}
function matchSequenceMessages(
  messages: UmlSequenceProposal["messages"],
  events: readonly SequenceEvent[],
): boolean {
  let index = 0;
  for (const message of messages) {
    while (events[index]?.type === "return" && message.type !== "return")
      index++;
    const actual = events[index++];
    if (
      actual?.type !== message.type ||
      actual.from !== message.from ||
      actual.to !== message.to ||
      normalizedCode(actual.code) !== normalizedCode(message.code) ||
      !matchesRef(actual.doc, actual.node, message.ref)
    )
      return false;
  }
  return events.slice(index).every((e) => e.type === "return");
}
function proveSequence(
  proposal: UmlSequenceProposal,
  docs: readonly UmlSourceDocument[],
): boolean {
  const scope = scopedFunction(docs, proposal.scope);
  if (!scope) return false;
  const participants = new Map(proposal.participants.map((p) => [p.name, p]));
  if (participants.size !== proposal.participants.length) return false;
  if (
    !proposal.participants.every((participant) =>
      proveParticipant(participant, docs),
    )
  )
    return false;
  const rootName = functionName(scope.doc, scope.node);
  if (!rootName) return false;
  const root = participants.get(rootName);
  if (root?.kind !== "context") return false;
  const targets = sequenceTargets(root, rootName, docs);
  if (targets.length !== 1 || targets[0].node !== scope.node) return false;
  const state: SequenceWalk = {
    docs,
    participants,
    events: [],
    active: new Set(),
  };
  return (
    walkSequence(state, scope.doc, scope.node, rootName) &&
    matchSequenceMessages(proposal.messages, state.events)
  );
}
const arduinoCallbacks = new Set(["setup", "loop"]);
/** A callback may be declared, but using its value can hide reentry behind an alias,
 * helper or cast. Do not pretend to resolve such indirect dispatch. */
function hasCallbackValueReference(doc: UmlSourceDocument): boolean {
  return doc.nodes.some((node) => {
    if (
      node.name !== "Identifier" ||
      !arduinoCallbacks.has(codeText(doc, node))
    )
      return false;
    const parent = node.parent;
    const first = parent?.firstChild;
    return (
      parent?.name !== "FunctionDeclarator" ||
      first?.name !== "Identifier" ||
      first.from !== node.from ||
      first.to !== node.to
    );
  });
}
function runtimeValueBindings(docs: readonly UmlSourceDocument[]): Set<string> {
  const names = new Set<string>();
  const declarator = (doc: UmlSourceDocument, node: SyntaxNode): void => {
    if (node.name === "Identifier") {
      names.add(codeText(doc, node));
      return;
    }
    if (
      node.name === "FunctionDeclarator" &&
      node.firstChild?.name === "Identifier"
    )
      return;
    if (node.name === "InitDeclarator" || node.name.endsWith("Declarator")) {
      const first = children(node).find(
        (child) => !["(", ")"].includes(child.name),
      );
      if (first) declarator(doc, first);
    }
  };
  for (const doc of docs)
    for (const declaration of nodesNamed(doc, "Declaration"))
      for (const child of children(declaration)) declarator(doc, child);
  return names;
}
/**
 * `Serial.begin(…)`, `Serial.println(…)`: a method of the core's serial object, which never calls back
 * into `setup` or `loop`. Only while the sketch declares no `Serial` of its own; a macro would already
 * have rejected the sources.
 */
function isCoreSerialCall(
  doc: UmlSourceDocument,
  target: SyntaxNode,
  values: ReadonlySet<string>,
): boolean {
  if (target.name !== "FieldExpression" || values.has("Serial")) return false;
  const [object, field, ...rest] = children(target);
  return (
    rest.length === 0 &&
    object?.name === "Identifier" &&
    codeText(doc, object) === "Serial" &&
    field?.name === "FieldIdentifier" &&
    doc.text.slice(object.to, field.from).trim() === "."
  );
}
function hasUnsupportedRuntimeCall(
  doc: UmlSourceDocument,
  block: SyntaxNode,
  values: ReadonlySet<string>,
): boolean {
  return nodesNamed(doc, "CallExpression").some((call) => {
    if (call.from < block.from || call.to > block.to) return false;
    let target = call.firstChild;
    // Parentheses alone do not change a free function's identity.
    while (target?.name === "ParenthesizedExpression") {
      const operands = children(target).filter(
        (child) =>
          !["(", ")", "Comment", "LineComment", "BlockComment"].includes(
            child.name,
          ),
      );
      if (operands.length !== 1) return true;
      target = operands[0];
    }
    if (target && isCoreSerialCall(doc, target, values)) return false;
    // Pointer, subscript, cast, callable-object/member and unresolved qualified
    // targets need binding/type facts this runtime proof intentionally lacks.
    return (
      target?.name !== "Identifier" ||
      arduinoCallbacks.has(codeText(doc, target)) ||
      values.has(codeText(doc, target))
    );
  });
}
function proveArduinoActivity(
  proposal: UmlArduinoActivityProposal,
  context: UmlCodeContext,
  docs: readonly UmlSourceDocument[],
): boolean {
  if (
    !hasArduinoRuntimeFacts(context) ||
    proposal.profile !== ARDUINO_UML_RUNTIME_FACTS.profile ||
    proposal.scope.file !== context.entryFile
  )
    return false;
  const globals = docs.flatMap((doc) =>
    nodesNamed(doc, "FunctionDefinition")
      .filter((node) => node.parent?.name === "Program")
      .map((node) => ({ doc, node, name: functionName(doc, node) })),
  );
  // Overrides and custom hooks could alter the catalog's projected callback path.
  if (
    globals.some((f) =>
      /^(?:main|init|initVariant|setupUSB|yield|serialEvent(?:Run|\d+)?)$/.test(
        f.name ?? "",
      ),
    )
  )
    return false;
  if (
    proposal.setup.body.length + proposal.loop.body.length === 0 ||
    docs.some(hasCallbackValueReference)
  )
    return false;
  const values = runtimeValueBindings(docs);
  for (const name of ["setup", "loop"] as const) {
    const functions = globals.filter((f) => f.name === name);
    if (functions.length !== 1) return false;
    const { doc, node } = functions[0];
    const block = children(node).find((n) => n.name === "CompoundStatement");
    if (
      !block ||
      doc.file !== context.entryFile ||
      !matchesRef(doc, node, proposal[name].ref)
    )
      return false;
    const signature = doc.text.slice(node.from, block.from).trim();
    if (
      !new RegExp(String.raw`^void\s+${name}\s*\(\s*(?:void)?\s*\)$`).test(
        signature,
      )
    )
      return false;
    if (
      proposal[name].ref.startLine < proposal.scope.startLine ||
      proposal[name].ref.endLine > proposal.scope.endLine ||
      !proveActivity(doc, block, proposal[name].body)
    )
      return false;
    if (hasUnsupportedRuntimeCall(doc, block, values)) return false;
  }
  return (
    proposal.scope.startLine ===
      Math.min(proposal.setup.ref.startLine, proposal.loop.ref.startLine) &&
    proposal.scope.endLine ===
      Math.max(proposal.setup.ref.endLine, proposal.loop.ref.endLine)
  );
}
function diagramCounts(proposal: UmlDiagramProposal): {
  nodes: number;
  edges: number;
  members: number;
} {
  let nodes: number,
    edges: number,
    members = 0;
  if (proposal.kind === "activity") {
    if ("runtime" in proposal) {
      const setup = countSteps(proposal.setup.body),
        loop = countSteps(proposal.loop.body);
      nodes = setup.nodes + loop.nodes + 5; // start + callback invocations + merge/true guard
      edges = setup.edges + loop.edges + 5; // includes the app-owned guarded back edge
    } else {
      ({ nodes, edges } = countSteps(proposal.body));
      nodes += 2;
      edges += 1;
    }
  } else if (proposal.kind === "class") {
    nodes = proposal.classes.length;
    edges = proposal.relations.length;
    members = proposal.classes.reduce((n, c) => n + c.members.length, 0);
  } else {
    nodes = proposal.participants.length;
    edges = proposal.messages.length;
  }
  return { nodes, edges, members };
}
function proveDiagram(
  proposal: UmlDiagramProposal,
  context: UmlCodeContext,
  docs: readonly UmlSourceDocument[],
): boolean {
  let proven: boolean;
  if (proposal.kind === "activity") {
    if ("runtime" in proposal)
      proven = proveArduinoActivity(proposal, context, docs);
    else if ("excerpt" in proposal)
      proven = proveActivityExcerpt(proposal, docs);
    else {
      const scope = scopedFunction(docs, proposal.scope);
      // Standalone callbacks require the app-owned runtime variant.
      const name = scope && functionName(scope.doc, scope.node);
      const block =
        scope &&
        children(scope.node).find((n) => n.name === "CompoundStatement");
      proven =
        !!scope &&
        !!block &&
        name !== "setup" &&
        name !== "loop" &&
        proveActivity(scope.doc, block, proposal.body);
    }
  } else if (proposal.kind === "class") proven = proveClasses(proposal, docs);
  else proven = proveSequence(proposal, docs);
  return proven;
}
/** Deterministic safeguards are deliberately narrower than general semantic usefulness. */
export function validateTutorUmlProposal(
  input: unknown,
  context: UmlCodeContext,
): UmlValidation {
  let bytes: number;
  try {
    const json = JSON.stringify(input);
    if (!json) return { ok: false, reason: "invalid-schema" };
    bytes = Buffer.byteLength(json);
  } catch {
    return { ok: false, reason: "invalid-schema" };
  }
  if (bytes > TUTOR_UML_LIMITS.proposalBytes)
    return { ok: false, reason: "proposal-too-large" };
  const parsed = tutorUmlProposalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-schema" };
  const proposal = parsed.data;
  if (proposal.status === "not-useful") return { ok: true, proposal };
  // Known atomic/ambiguous question counterexamples. This is not a semantic judge.
  if (/\b(datentyp|data type)\b/i.test(context.question))
    return { ok: false, reason: "irrelevant" };
  if (
    /warum besteht der test mit [`"']?mittelwert\s*\(4,\s*8\)/i.test(
      context.question,
    )
  )
    return { ok: false, reason: "answer-leak" };
  const { nodes, edges, members } = diagramCounts(proposal);
  if (
    nodes > TUTOR_UML_LIMITS.nodes ||
    edges > TUTOR_UML_LIMITS.edges ||
    members > TUTOR_UML_LIMITS.members
  )
    return { ok: false, reason: "element-limit" };
  const docs = readUmlSources(context);
  if (!docs) return { ok: false, reason: "unsupported-code" };
  if (!validSpan(docs, proposal.scope))
    return { ok: false, reason: "invalid-evidence" };
  const proven = proveDiagram(proposal, context, docs);
  return proven
    ? { ok: true, proposal: proposal as ValidUmlProposal }
    : { ok: false, reason: "invalid-evidence" };
}

import { posix } from "node:path";
import { parser } from "@lezer/cpp";
import { BOARD_CATALOG } from "@shared/boards";
import { TUTOR_UML_PROFILE } from "@shared/tutor-uml-profile";
import type { SyntaxNode } from "@lezer/common";
import type {
  UmlActivityStep,
  UmlCodeContext,
  UmlSourceRef,
} from "@shared/tutor-uml";

export interface UmlSourceDocument {
  file: string;
  text: string;
  root: SyntaxNode;
  nodes: SyntaxNode[];
}
export const children = (node: SyntaxNode): SyntaxNode[] => {
  const list: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling)
    list.push(child);
  return list;
};
export const codeText = (doc: UmlSourceDocument, node: SyntaxNode): string =>
  doc.text.slice(node.from, node.to);
export const normalizedCode = (value: string): string => value.trim();
export const sourceLine = (doc: UmlSourceDocument, offset: number): number =>
  doc.text.slice(0, offset).split("\n").length;
export function matchesRef(
  doc: UmlSourceDocument,
  node: SyntaxNode,
  ref: UmlSourceRef,
): boolean {
  return (
    ref.file === doc.file &&
    ref.startLine === sourceLine(doc, node.from) &&
    ref.endLine === sourceLine(doc, Math.max(node.from, node.to - 1))
  );
}
export function nodesNamed(doc: UmlSourceDocument, name: string): SyntaxNode[] {
  return doc.nodes.filter((node) => node.name === name);
}
export function functionName(
  doc: UmlSourceDocument,
  node: SyntaxNode,
): string | undefined {
  const declarator = children(node).find(
    (child) => child.name === "FunctionDeclarator",
  );
  const name =
    declarator &&
    children(declarator).find(
      (child) =>
        child.name === "Identifier" || child.name === "FieldIdentifier",
    );
  return name && codeText(doc, name);
}
// ES2021-compatible own-property check, matching the course-content schema boundary.
function hasOwn(
  value: Readonly<Record<string, string>> | undefined,
  key: string,
): boolean {
  return (
    value !== undefined &&
    Reflect.getOwnPropertyDescriptor(value, key) !== undefined
  );
}
const COMMENTS = new Set(["Comment", "LineComment", "BlockComment"]);
/** Syntax nodes are created on access; the same node is the same type at the same span. */
const same = (a: SyntaxNode | null | undefined, b: SyntaxNode | null | undefined): boolean =>
  !!a && !!b && a.type === b.type && a.from === b.from && a.to === b.to;
const directiveText = (text: string, node: SyntaxNode): string =>
  text.slice(node.from, node.to).replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, " ").trim();
/**
 * Whether the guard of a header (`#ifndef X` / `#define X` first, `#endif` last, nothing else outside)
 * is what `directives` start and end with. Such a guard only keeps a second inclusion out.
 */
function isIncludeGuard(text: string, root: SyntaxNode, directives: readonly SyntaxNode[]): boolean {
  if (directives.length < 3) return false;
  const top = children(root).filter((node) => !COMMENTS.has(node.name));
  const [open, define] = directives;
  const close = directives.at(-1)!;
  const guard = /^#\s*ifndef\s+(\w+)$/.exec(directiveText(text, open))?.[1];
  return (
    guard !== undefined &&
    same(top[0], open) && same(top[1], define) && same(top.at(-1), close) &&
    new RegExp(String.raw`^#\s*define\s+${guard}$`).test(directiveText(text, define)) &&
    /^#\s*endif$/.test(directiveText(text, close))
  );
}
/** A quoted include names a file next to the one that includes it, as the compiler looks it up first. */
function includedFile(includer: string, target: string): string {
  return posix.normalize(posix.join(posix.dirname(includer), target));
}
/**
 * Preprocessing that cannot change the code the parser sees: `#include "…"` of a file that was sent
 * along (looked up next to the including file) and, in a header, `#pragma once` or an include guard. Every other directive rejects the file.
 */
function harmlessPreprocessing(
  file: string,
  text: string,
  root: SyntaxNode,
  nodes: readonly SyntaxNode[],
  header: boolean,
  headers: UmlCodeContext["headers"],
): boolean {
  const all = nodes.filter((node) => /Preproc/.test(node.name));
  const directives = all.filter((node) => node.name === "PreprocDirective" && same(node.parent, root));
  const known = (node: SyntaxNode | null) => directives.some((directive) => same(directive, node));
  // A directive anywhere else than at file level (or not recognized as one) stays unexplained.
  if (all.some((node) => !known(node) && !known(node.parent))) return false;
  const guarded = header && isIncludeGuard(text, root, directives);
  const rest = guarded ? directives.slice(2, -1) : directives;
  return rest.every((node) => {
    const directive = directiveText(text, node);
    if (header && /^#\s*pragma\s+once$/.test(directive)) return true;
    const include = /^#\s*include\s*"([^"\n]+)"$/.exec(directive);
    return include !== null && hasOwn(headers, includedFile(file, include[1]));
  });
}
/** No macro expansion or compiler claim: ambiguous preprocessing and any parse error reject the evidence. */
export function readUmlSources(
  context: UmlCodeContext,
): UmlSourceDocument[] | null {
  if (!context.entryFile || !context.board || !context.question.trim())
    return null;
  const files = {
    ...context.headers,
    [context.entryFile]: context.code,
  };
  if (hasOwn(context.headers, context.entryFile)) return null;
  const docs: UmlSourceDocument[] = [];
  for (const [file, text] of Object.entries(files)) {
    const root = parser.parse(text).topNode;
    const nodes: SyntaxNode[] = [];
    const walk = (node: SyntaxNode): void => {
      nodes.push(node);
      children(node).forEach(walk);
    };
    walk(root);
    // Preprocessor directives must not silently change the apparent tree. Includes are
    // only accepted when their exact target is among the files sent to the provider.
    if (nodes.some((node) => node.type.isError)) return null;
    if (!harmlessPreprocessing(file, text, root, nodes, file !== context.entryFile, context.headers)) return null;
    docs.push({ file, text, root, nodes });
  }
  return docs;
}
function statementChildren(node: SyntaxNode): SyntaxNode[] {
  return children(node).filter(
    (child) =>
      !["{", "}", "Comment", "LineComment", "BlockComment"].includes(
        child.name,
      ),
  );
}
function proveAction(
  doc: UmlSourceDocument,
  block: SyntaxNode,
  statement: SyntaxNode,
  step: Extract<UmlActivityStep, { type: "action" }>,
  index: number,
  length: number,
): boolean {
  if (
    !["ExpressionStatement", "Declaration", "ReturnStatement"].includes(
      statement.name,
    )
  )
    return false;
  if (
    statement.name === "ExpressionStatement" &&
    !children(statement).some((n) =>
      ["CallExpression", "AssignmentExpression", "UpdateExpression"].includes(
        n.name,
      ),
    )
  )
    return false;
  if (
    statement.name === "Declaration" &&
    !children(statement).some((n) => n.name === "InitDeclarator")
  )
    return false;
  // Return is terminal; unsupported early exits cannot be flattened.
  if (
    statement.name === "ReturnStatement" &&
    (index !== length - 1 || block.parent?.name !== "FunctionDefinition")
  )
    return false;
  return normalizedCode(codeText(doc, statement)) === normalizedCode(step.code);
}
function proveBranches(
  doc: UmlSourceDocument,
  branches: readonly SyntaxNode[],
  step: Exclude<UmlActivityStep, { type: "action" }>,
): boolean {
  // Keep branch positions: unbraced branches must never be omitted or reversed.
  if (step.type === "loop")
    return (
      branches.length === 1 &&
      branches[0].name === "CompoundStatement" &&
      proveActivity(doc, branches[0], step.body)
    );
  if (branches[0]?.name !== "CompoundStatement") return false;
  if (branches.length === 1)
    return (
      step.whenFalse.length === 0 &&
      proveActivity(doc, branches[0], step.whenTrue)
    );
  return (
    branches.length === 3 &&
    branches[1].name === "else" &&
    branches[2].name === "CompoundStatement" &&
    proveActivity(doc, branches[0], step.whenTrue) &&
    proveActivity(doc, branches[2], step.whenFalse)
  );
}
function proveControlStep(
  doc: UmlSourceDocument,
  statement: SyntaxNode,
  step: Exclude<UmlActivityStep, { type: "action" }>,
): boolean {
  if (
    statement.name !==
    (step.type === "decision" ? "IfStatement" : "WhileStatement")
  )
    return false;
  const parts = children(statement);
  const condition = parts.find((n) => n.name === "ConditionClause");
  if (!condition) return false;
  const conditionText = codeText(doc, condition).trim().slice(1, -1);
  if (/^(?:true|false|\d+)$/.test(conditionText.trim())) return false;
  if (normalizedCode(conditionText) !== normalizedCode(step.condition))
    return false;
  const branches = parts
    .slice(parts.indexOf(condition) + 1)
    .filter(
      (n) => !["Comment", "LineComment", "BlockComment"].includes(n.name),
    );
  return proveBranches(doc, branches, step);
}
/** The complete selected function body is retained: omission cannot invent adjacency. */
/** The parts of `for (init; condition; update) body`; `ref` spans its head, where init and update stand. */
export interface ForHeader {
  readonly init: string;
  readonly condition: string;
  readonly update: string;
  readonly ref: UmlSourceRef;
  readonly body: SyntaxNode;
}
export function forHeader(
  doc: UmlSourceDocument,
  statement: SyntaxNode,
): ForHeader | undefined {
  const parts = children(statement);
  const open = parts.find(({ name }) => name === "(");
  const close = parts.find(({ name }) => name === ")");
  const body = parts
    .filter(({ name }) => !["Comment", "LineComment", "BlockComment"].includes(name))
    .at(-1);
  if (!open || !close || !body || body.from < close.to) return undefined;
  const header = doc.text.slice(open.to, close.from).split(";").map((part) => part.trim());
  if (header.length !== 3) return undefined;
  const [init, condition, update] = header;
  const ref = { file: doc.file, startLine: sourceLine(doc, open.from), endLine: sourceLine(doc, close.from) };
  return { init, condition, update, ref, body };
}
const sameRef = (left: UmlSourceRef, right: UmlSourceRef): boolean =>
  left.file === right.file && left.startLine === right.startLine && left.endLine === right.endLine;
/** An action that stands for a part of a `for` head: the part with its semicolon, referring to the head. */
const isHeadAction = (step: UmlActivityStep | undefined, code: string, head: ForHeader): boolean =>
  step?.type === "action" && normalizedCode(step.code) === `${code};` && sameRef(step.ref, head.ref);
/**
 * A `for` statement is shown as it runs: its init as an action, then a loop over its condition whose body
 * ends with the update as an action (the shape the application's own excerpt builds). Returns how many
 * steps it took, 0 when they do not prove it.
 */
function proveFor(
  doc: UmlSourceDocument,
  statement: SyntaxNode,
  steps: readonly UmlActivityStep[],
): number {
  const head = forHeader(doc, statement);
  if (!head || head.body.name !== "CompoundStatement") return 0;
  if (!head.condition || /^(?:true|false|\d+)$/.test(head.condition)) return 0;
  const used = head.init ? 1 : 0;
  if (head.init && !isHeadAction(steps[0], head.init, head)) return 0;
  const loop = steps[used];
  if (
    loop?.type !== "loop" ||
    !matchesRef(doc, statement, loop.ref) ||
    normalizedCode(loop.condition) !== head.condition
  )
    return 0;
  if (head.update && !isHeadAction(loop.body.at(-1), head.update, head)) return 0;
  const inner = head.update ? loop.body.slice(0, -1) : loop.body;
  return proveActivity(doc, head.body, inner) ? used + 1 : 0;
}
export function proveActivity(
  doc: UmlSourceDocument,
  block: SyntaxNode,
  steps: readonly UmlActivityStep[],
): boolean {
  const statements = statementChildren(block);
  let at = 0;
  for (const [index, statement] of statements.entries()) {
    if (statement.name === "ForStatement") {
      const used = proveFor(doc, statement, steps.slice(at));
      if (used === 0) return false;
      at += used;
      continue;
    }
    const step = steps[at++];
    if (!step || !matchesRef(doc, statement, step.ref)) return false;
    const proven =
      step.type === "action"
        ? proveAction(doc, block, statement, step, index, statements.length)
        : proveControlStep(doc, statement, step);
    if (!proven) return false;
  }
  return at === steps.length;
}
export function scopedFunction(
  docs: readonly UmlSourceDocument[],
  ref: UmlSourceRef,
): { doc: UmlSourceDocument; node: SyntaxNode } | undefined {
  const found = docs.flatMap((doc) =>
    nodesNamed(doc, "FunctionDefinition")
      .filter((node) => matchesRef(doc, node, ref))
      .map((node) => ({ doc, node })),
  );
  return found.length === 1 ? found[0] : undefined;
}
export function className(
  doc: UmlSourceDocument,
  node: SyntaxNode,
): string | undefined {
  const name = children(node).find((n) => n.name === "TypeIdentifier");
  return name && codeText(doc, name);
}
export function memberDeclaration(
  doc: UmlSourceDocument,
  node: SyntaxNode,
): string {
  const body = children(node).find((n) => n.name === "CompoundStatement");
  return normalizedCode(
    doc.text
      .slice(node.from, body?.from ?? node.to)
      .trim()
      .replace(/;$/, ""),
  );
}
export function classMembers(
  doc: UmlSourceDocument,
  node: SyntaxNode,
): {
  node: SyntaxNode;
  visibility: string;
  kind: "attribute" | "operation";
  declaration: string;
}[] {
  const fieldList = children(node).find(
    (n) => n.name === "FieldDeclarationList",
  );
  if (!fieldList) return [];
  let visibility = /^struct\b/.test(codeText(doc, node)) ? "public" : "private";
  const members: ReturnType<typeof classMembers> = [];
  for (const child of children(fieldList)) {
    if (child.name === "AccessSpecifier")
      visibility = codeText(doc, child).replace(/:$/, "").trim();
    else if (
      child.name === "FieldDeclaration" ||
      child.name === "FunctionDefinition"
    )
      members.push({
        node: child,
        visibility,
        kind: children(child).some((n) => n.name === "FunctionDeclarator")
          ? "operation"
          : "attribute",
        declaration: memberDeclaration(doc, child),
      });
  }
  return members;
}
/** This profile only proves literal defaults; evaluating other initializers may hide calls. */
export function hasUnsupportedSequenceDefaults(
  doc: UmlSourceDocument,
  fn: SyntaxNode,
): boolean {
  const declarator = children(fn).find((n) => n.name === "FunctionDeclarator");
  if (!declarator) return true;
  return doc.nodes.some((node) => {
    if (
      node.name !== "OptionalParameterDeclaration" ||
      node.from < declarator.from ||
      node.to > declarator.to
    ) return false;
    const initializer = children(node).at(-1);
    return (
      !initializer ||
      !["Number", "String", "CharLiteral", "True", "False", "nullptr"].includes(
        initializer.name,
      )
    );
  });
}
export function straightStatements(node: SyntaxNode): SyntaxNode[] | undefined {
  const body = children(node).find((n) => n.name === "CompoundStatement");
  if (!body) return undefined;
  const statements = statementChildren(body);
  return statements.every((n) =>
    ["ExpressionStatement", "ReturnStatement"].includes(n.name),
  )
    ? statements
    : undefined;
}

/** App-owned projection of the pinned Arduino AVR main.cpp callback contract.
 * Source inspected: arduino:avr@1.8.8, cores/arduino/main.cpp: setup(); for (;;) { loop(); ... }
 * Core initialization/USB/serial hooks are outside this explicitly named callback view.
 */
export const ARDUINO_UML_RUNTIME_FACTS = Object.freeze({
  profile: TUTOR_UML_PROFILE,
  revision: "arduino-avr-1.8.8-main-callbacks-v1",
  core: Object.freeze({ id: "arduino:avr", version: "1.8.8" }),
  boards: Object.freeze(["uno", "nano", "mega2560"] as const),
  setupCalls: 1,
  loopCalls: "repeat-forever",
  end: false,
} as const);
export function hasArduinoRuntimeFacts(context: UmlCodeContext): boolean {
  const board = BOARD_CATALOG.find((b) => b.id === context.board);
  return (
    !!board &&
    (ARDUINO_UML_RUNTIME_FACTS.boards as readonly string[]).includes(
      context.board,
    ) &&
    board.core.id === ARDUINO_UML_RUNTIME_FACTS.core.id &&
    board.core.version === ARDUINO_UML_RUNTIME_FACTS.core.version
  );
}
/** Conservative scope binding: parameters and class members cannot be mistaken for globals. */
export function hasParticipantShadow(
  doc: UmlSourceDocument,
  fn: SyntaxNode,
  names: ReadonlySet<string>,
): boolean {
  const declarator = children(fn).find((n) => n.name === "FunctionDeclarator");
  if (!declarator) return true;
  const parameters = doc.nodes.filter(
    (n) =>
      n.name === "ParameterDeclaration" &&
      n.from >= declarator.from &&
      n.to <= declarator.to,
  );
  if (
    parameters.some((parameter) =>
      doc.nodes.some(
        (n) =>
          n.name === "Identifier" &&
          n.from >= parameter.from &&
          n.to <= parameter.to &&
          names.has(codeText(doc, n)),
      ),
    )
  )
    return true;
  const klass =
    fn.parent?.name === "FieldDeclarationList" ? fn.parent.parent : undefined;
  if (!klass) return false;
  // Inherited lookup is outside this small sequence proof.
  if (children(klass).some((n) => n.name === "BaseClassClause")) return true;
  return classMembers(doc, klass).some((member) =>
    doc.nodes.some(
      (n) =>
        n.name === "FieldIdentifier" &&
        n.from >= member.node.from &&
        n.to <= member.node.to &&
        names.has(codeText(doc, n)),
    ),
  );
}

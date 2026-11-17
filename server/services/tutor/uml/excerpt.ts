import { isDeepStrictEqual } from "node:util";
import type { SyntaxNode } from "@lezer/common";
import { TUTOR_UML_PROFILE } from "@shared/tutor-uml-profile";
import type { UmlActivityStep, UmlCodeContext, UmlExcerptActivityProposal, UmlSourceRef } from "@shared/tutor-uml";
import { children, codeText, nodesNamed, readUmlSources, sourceLine, type UmlSourceDocument } from "./source";

/**
 * The activity diagram of one control statement, built by the application from the code (Tutor concept,
 * stage 3). Nothing here comes from a provider: a proposal of this variant is valid only when it equals
 * what this module builds for its scope.
 */
const CONTROL_STATEMENTS = ["IfStatement", "WhileStatement", "ForStatement"] as const;
const SIMPLE_STATEMENTS = new Set(["ExpressionStatement", "Declaration", "ReturnStatement"]);
const IGNORED = new Set(["{", "}", "Comment", "LineComment", "BlockComment"]);
/** One action node holds a run of plain statements; longer runs continue in the next node. */
const MAX_ACTION_LINES = 6;
const MAX_ACTION_CHARS = 320;

class Unsupported extends Error {}

function refOf(doc: UmlSourceDocument, from: SyntaxNode, to: SyntaxNode = from): UmlSourceRef {
  return { file: doc.file, startLine: sourceLine(doc, from.from), endLine: sourceLine(doc, Math.max(to.from, to.to - 1)) };
}

function actions(doc: UmlSourceDocument, run: readonly SyntaxNode[]): UmlActivityStep[] {
  const steps: UmlActivityStep[] = [];
  let group: SyntaxNode[] = [];
  const text = (nodes: readonly SyntaxNode[]) => nodes.map((node) => codeText(doc, node).trim()).join("\n");
  const flush = () => {
    if (group.length > 0) steps.push({ type: "action", code: text(group), ref: refOf(doc, group[0], group.at(-1)) });
    group = [];
  };
  for (const statement of run) {
    if (text([statement]).length > MAX_ACTION_CHARS) throw new Unsupported();
    if (group.length >= MAX_ACTION_LINES || text([...group, statement]).length > MAX_ACTION_CHARS) flush();
    group.push(statement);
  }
  flush();
  return steps;
}

function bodySteps(doc: UmlSourceDocument, body: SyntaxNode | undefined): UmlActivityStep[] {
  if (!body) throw new Unsupported();
  const statements = body.name === "CompoundStatement" ? children(body).filter(({ name }) => !IGNORED.has(name)) : [body];
  const steps: UmlActivityStep[] = [];
  let run: SyntaxNode[] = [];
  statements.forEach((statement, index) => {
    if (SIMPLE_STATEMENTS.has(statement.name)) {
      // Code after a return never runs; a diagram of it would show a path that does not exist.
      if (statement.name === "ReturnStatement" && index !== statements.length - 1) throw new Unsupported();
      run.push(statement);
      return;
    }
    steps.push(...actions(doc, run), ...controlSteps(doc, statement));
    run = [];
  });
  return [...steps, ...actions(doc, run)];
}

function withoutComments(nodes: readonly SyntaxNode[]): SyntaxNode[] {
  return nodes.filter(({ name }) => !IGNORED.has(name));
}

function decision(doc: UmlSourceDocument, statement: SyntaxNode): UmlActivityStep {
  const parts = withoutComments(children(statement));
  const clause = parts.find(({ name }) => name === "ConditionClause");
  if (!clause) throw new Unsupported();
  const [whenTrue, keyword, whenFalse] = parts.slice(parts.indexOf(clause) + 1);
  if (keyword && keyword.name !== "else") throw new Unsupported();
  return {
    type: "decision",
    condition: codeText(doc, clause).trim().slice(1, -1).trim(),
    ref: refOf(doc, statement),
    whenTrue: bodySteps(doc, whenTrue),
    whenFalse: keyword ? bodySteps(doc, whenFalse) : [],
  };
}

function loopStep(doc: UmlSourceDocument, statement: SyntaxNode, condition: string, body: UmlActivityStep[]): UmlActivityStep {
  if (body.length === 0 || condition === "") throw new Unsupported();
  return { type: "loop", condition, ref: refOf(doc, statement), body };
}

/** `for (init; condition; update) body` runs as: init, then while (condition) { body; update }. */
function forSteps(doc: UmlSourceDocument, statement: SyntaxNode): UmlActivityStep[] {
  const parts = children(statement);
  const open = parts.find(({ name }) => name === "(");
  const close = parts.find(({ name }) => name === ")");
  const body = withoutComments(parts).at(-1);
  if (!open || !close || !body || body === close) throw new Unsupported();
  const header = doc.text.slice(open.to, close.from).split(";").map((part) => part.trim());
  if (header.length !== 3) throw new Unsupported();
  const [init, condition, update] = header;
  const ref = { file: doc.file, startLine: sourceLine(doc, open.from), endLine: sourceLine(doc, close.from) };
  const action = (code: string): UmlActivityStep[] => (code ? [{ type: "action", code: `${code};`, ref }] : []);
  return [...action(init), loopStep(doc, statement, condition, [...bodySteps(doc, body), ...action(update)])];
}

function controlSteps(doc: UmlSourceDocument, statement: SyntaxNode): UmlActivityStep[] {
  if (statement.name === "IfStatement") return [decision(doc, statement)];
  if (statement.name === "ForStatement") return forSteps(doc, statement);
  if (statement.name !== "WhileStatement") throw new Unsupported();
  const parts = withoutComments(children(statement));
  const clause = parts.find(({ name }) => name === "ConditionClause");
  if (!clause) throw new Unsupported();
  return [loopStep(doc, statement, codeText(doc, clause).trim().slice(1, -1).trim(), bodySteps(doc, parts[parts.indexOf(clause) + 1]))];
}

/** The steps of one control statement; null when it holds something the profile cannot show. */
export function buildActivityExcerpt(doc: UmlSourceDocument, statement: SyntaxNode): UmlActivityStep[] | null {
  try {
    return controlSteps(doc, statement);
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

function controlStatements(doc: UmlSourceDocument): SyntaxNode[] {
  return CONTROL_STATEMENTS.flatMap((name) => nodesNamed(doc, name)).sort((left, right) => left.from - right.from);
}

function squeeze(value: string): string {
  return value.replaceAll(/\s+/g, "");
}

/** The head of a statement: everything before its body, where the condition stands. */
function head(doc: UmlSourceDocument, statement: SyntaxNode): string {
  const body = withoutComments(children(statement)).find(({ name }) => name === "CompoundStatement");
  return doc.text.slice(statement.from, body?.from ?? statement.to);
}

const RELATIONAL = /(?<![<>=!-])(<=|>=|<|>)(?![<>=])/;
const REVERSED: Readonly<Record<string, string>> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };

type Controlled = Exclude<UmlActivityStep, { type: "action" }>;

function nested(step: UmlActivityStep): UmlActivityStep[][] {
  if (step.type === "decision") return [step.whenTrue, step.whenFalse];
  return step.type === "loop" ? [step.body] : [];
}

/** The first step, in reading order, that `fits`, replaced by `change(step)`; null when none fits. */
function changeFirst(steps: readonly UmlActivityStep[], fits: (step: Controlled) => boolean, change: (step: Controlled) => UmlActivityStep): UmlActivityStep[] | null {
  for (const [index, step] of steps.entries()) {
    if (step.type === "action") continue;
    if (fits(step)) return steps.with(index, change(step));
    const lists = nested(step);
    for (const [position, list] of lists.entries()) {
      const changed = changeFirst(list, fits, change);
      if (!changed) continue;
      const [first, second] = lists.with(position, changed);
      return steps.with(index, step.type === "decision" ? { ...step, whenTrue: first, whenFalse: second } : { ...step, body: first });
    }
  }
  return null;
}

/**
 * One deliberate error for a find-the-error question, always the same for the same statement: the first
 * ordered comparison is reversed; without one, the branches of the first decision change places.
 */
export function injectActivityError(steps: readonly UmlActivityStep[]): { readonly body: UmlActivityStep[]; readonly note: string } | null {
  let note = "";
  const reversed = changeFirst(steps, ({ condition }) => RELATIONAL.test(condition), (step) => {
    const condition = step.condition.replace(RELATIONAL, (operator) => REVERSED[operator] ?? operator);
    note = `Im Code lautet die Bedingung \`${step.condition}\`, im Diagramm steht \`${condition}\`.`;
    return { ...step, condition };
  });
  if (reversed) return { body: reversed, note };
  const swappable = (step: Controlled) => step.type === "decision" && !isDeepStrictEqual(step.whenTrue, step.whenFalse);
  const swapped = changeFirst(steps, swappable, (step) => {
    note = `Im Diagramm sind die Zweige hinter den Kanten \`[${step.condition}]\` und \`[sonst]\` vertauscht.`;
    return step.type === "decision" ? { ...step, whenTrue: step.whenFalse, whenFalse: step.whenTrue } : step;
  });
  return swapped ? { body: swapped, note } : null;
}

/** Whether the excerpt proposal is exactly what the application builds for its scope. */
export function proveActivityExcerpt(proposal: UmlExcerptActivityProposal, docs: readonly UmlSourceDocument[]): boolean {
  const doc = docs.find(({ file }) => file === proposal.scope.file);
  const statement = doc && controlStatements(doc).find((node) => isDeepStrictEqual(refOf(doc, node), proposal.scope));
  const correct = doc && statement ? buildActivityExcerpt(doc, statement) : null;
  const built = correct && proposal.excerpt === "statement-with-error" ? injectActivityError(correct)?.body ?? null : correct;
  return built !== null && isDeepStrictEqual(built, proposal.body);
}

/** The control statement of the entry file whose head holds `siteCode`, with its steps (null when it cannot be shown). */
function siteStatement(context: UmlCodeContext, siteCode: string): { doc: UmlSourceDocument; statement: SyntaxNode; steps: UmlActivityStep[] | null } | undefined {
  return statementIn(entryDocument(context), siteCode);
}

function entryDocument(context: UmlCodeContext): UmlSourceDocument | undefined {
  return readUmlSources(context)?.find(({ file }) => file === context.entryFile);
}

function sketchContext(code: string): UmlCodeContext {
  return { question: "-", code, entryFile: "sketch.ino", board: "uno" };
}

function statementIn(doc: UmlSourceDocument | undefined, siteCode: string): { doc: UmlSourceDocument; statement: SyntaxNode; steps: UmlActivityStep[] | null } | undefined {
  const wanted = squeeze(siteCode);
  const statement = doc && wanted ? controlStatements(doc).find((node) => squeeze(head(doc, node)).includes(wanted)) : undefined;
  return doc && statement ? { doc, statement, steps: buildActivityExcerpt(doc, statement) } : undefined;
}

/**
 * The excerpt proposal for the control statement whose head holds `siteCode`, in the entry file. Undefined
 * when the sources cannot be read, no such statement exists or it cannot be shown.
 */
export function activityExcerptProposal(context: UmlCodeContext, siteCode: string, withError = false): UmlExcerptActivityProposal | undefined {
  const found = siteStatement(context, siteCode);
  const body = found?.steps && withError ? injectActivityError(found.steps)?.body : found?.steps;
  if (!found || !body || body.length === 0) return undefined;
  const scope = refOf(found.doc, found.statement);
  return {
    version: 1,
    profile: TUTOR_UML_PROFILE,
    status: "diagram",
    kind: "activity",
    excerpt: withError ? "statement-with-error" : "statement",
    purpose: withError
      ? `Ablauf der Anweisung in den Zeilen ${scope.startLine} bis ${scope.endLine} mit genau einem eingebauten Fehler`
      : `Ablauf der Anweisung in den Zeilen ${scope.startLine} bis ${scope.endLine} als Kontext zur Frage`,
    scope,
    body,
  };
}

/**
 * What the application changed in the find-the-error diagram of the statement whose head holds `siteCode`,
 * for the model's rating. Undefined when no such diagram can be built from this code.
 */
export function activityErrorNote(code: string, siteCode: string): string | undefined {
  const steps = siteStatement(sketchContext(code), siteCode)?.steps;
  return steps ? injectActivityError(steps)?.note : undefined;
}

/** Those of `siteCodes` whose control statement the application can draw as an activity diagram. */
export function drawableSiteCodes(code: string, siteCodes: readonly string[]): Set<string> {
  const doc = entryDocument(sketchContext(code));
  return new Set(siteCodes.filter((siteCode) => (statementIn(doc, siteCode)?.steps?.length ?? 0) > 0));
}

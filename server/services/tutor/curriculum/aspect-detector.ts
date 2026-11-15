import { parser } from "@lezer/cpp";
import type { SyntaxNode } from "@lezer/common";

/**
 * The aspects of a sketch the Tutor can ask about (Tutor concept, stage 2). The detector reads the syntax
 * tree only: no macro expansion, no type checking. An aspect it finds comes with the places it was found
 * at ("sites") and a weight that says how much of the sketch the aspect carries.
 */
export const ASPECT_IDS = [
  "variables", "expressions", "branching", "loops", "functions", "arrays", "scope", "serial", "pins", "timing", "program-flow",
] as const;
export type AspectId = typeof ASPECT_IDS[number];

/** What a site offers; a question assignment names what it needs (`needs`). */
export const SITE_FEATURES = [
  "condition", "relational", "variable", "constant", "type", "initial-value", "else-branch", "else-if", "early-return", "nested",
  "counter", "bound", "index", "parameter", "return-value", "call", "output-value", "input", "output", "pin", "interval", "state",
] as const;
export type SiteFeature = typeof SITE_FEATURES[number];

export interface AspectSite {
  /** Stable while the code of the site stays the same; line numbers are not part of it. */
  readonly id: string;
  readonly function?: string;
  readonly line: number;
  readonly endLine: number;
  /** The text a question can quote: a condition, a declaration, a call. */
  readonly code: string;
  /** Identifiers of the sketch that name the site; a question about it must use one of them or quote `code`. */
  readonly names: readonly string[];
  readonly has: readonly SiteFeature[];
}

export interface DetectedAspect {
  readonly id: AspectId;
  readonly weight: number;
  readonly sites: readonly AspectSite[];
}

const MAX_SOURCE_CHARS = 200_000;
const MAX_SITES_PER_ASPECT = 24;
const MAX_SITE_CODE_CHARS = 120;
const ENTRY_FUNCTIONS = new Set(["setup", "loop"]);
const PIN_CALLS = new Set(["pinMode", "digitalRead", "digitalWrite", "analogRead", "analogWrite"]);
const PIN_INPUT_CALLS = new Set(["digitalRead", "analogRead"]);
const TIMING_CALLS = new Set(["delay", "delayMicroseconds", "millis", "micros"]);
const SERIAL_INPUT_CALLS = new Set(["read", "available", "parseInt", "parseFloat", "readString", "readStringUntil", "peek"]);
const LOOP_NODES = new Set(["ForStatement", "WhileStatement", "DoStatement"]);
const BRANCH_NODES = new Set(["IfStatement", "SwitchStatement"]);
const NOT_A_NAME = new Set(["HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "true", "false", "Serial", "LED_BUILTIN"]);

type Site = { function?: string; node: SyntaxNode; code: string; names: string[]; has: Set<SiteFeature> };
type Collected = Record<AspectId, Site[]>;

function kids(node: SyntaxNode): SyntaxNode[] {
  const list: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) list.push(child);
  return list;
}

function descendants(node: SyntaxNode, into: SyntaxNode[] = []): SyntaxNode[] {
  for (const child of kids(node)) {
    into.push(child);
    descendants(child, into);
  }
  return into;
}

class Source {
  private readonly lineStarts: number[] = [0];
  constructor(readonly text: string) {
    for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) this.lineStarts.push(index + 1);
  }
  of(node: SyntaxNode): string {
    return this.text.slice(node.from, node.to);
  }
  compact(node: SyntaxNode): string {
    return this.of(node).replaceAll(/\s+/g, " ").trim().slice(0, MAX_SITE_CODE_CHARS);
  }
  line(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.lineStarts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  }
}

function identifiers(source: Source, node: SyntaxNode): string[] {
  const own = node.name === "Identifier" ? [node] : [];
  const names = [...own, ...descendants(node).filter(({ name }) => name === "Identifier")].map((id) => source.of(id));
  return [...new Set(names.filter((name) => !NOT_A_NAME.has(name)))];
}

/** The called name: `delay` for `delay(1)`, `Serial.print` for `Serial.print(x)`. */
function calleeName(source: Source, call: SyntaxNode): string {
  const callee = call.firstChild;
  return callee ? source.of(callee).replaceAll(/\s+/g, "") : "";
}

function declaredNames(source: Source, declaration: SyntaxNode): { name: string; array: boolean; initialized: boolean }[] {
  const result: { name: string; array: boolean; initialized: boolean }[] = [];
  for (const child of kids(declaration)) {
    const initialized = child.name === "InitDeclarator";
    const declarator = initialized ? child.firstChild : child;
    if (!declarator) continue;
    if (declarator.name === "Identifier") result.push({ name: source.of(declarator), array: false, initialized });
    if (declarator.name === "ArrayDeclarator" && declarator.firstChild?.name === "Identifier") {
      result.push({ name: source.of(declarator.firstChild), array: true, initialized });
    }
  }
  return result;
}

function typeText(source: Source, declaration: SyntaxNode): string {
  const type = kids(declaration).find(({ name }) => name === "PrimitiveType" || name === "SizedTypeSpecifier" || name === "TypeIdentifier");
  return type ? source.of(type).replaceAll(/\s+/g, " ") : "";
}

function hasKeyword(declaration: SyntaxNode, keyword: string): boolean {
  return kids(declaration).some(({ name }) => name === keyword);
}

function enclosing(node: SyntaxNode, names: ReadonlySet<string>): SyntaxNode | null {
  for (let parent = node.parent; parent; parent = parent.parent) if (names.has(parent.name)) return parent;
  return null;
}

/** An `if` that is the `else` part of another `if` belongs to that chain, not to a site of its own. */
function isElseIf(node: SyntaxNode): boolean {
  return node.name === "IfStatement" && node.parent?.name === "IfStatement" && node.prevSibling?.name === "else";
}

/** The ways of an `if` chain: one per condition, one more for a closing `else`. */
function chainShape(node: SyntaxNode): { branches: number; elseIf: boolean; elseBranch: boolean } {
  let branches = 0;
  let elseIf = false;
  for (let current: SyntaxNode | undefined = node; current; ) {
    branches++;
    const parts = kids(current);
    const next: SyntaxNode | undefined = parts[parts.findIndex(({ name }) => name === "else") + 1];
    const afterElse = parts.some(({ name }) => name === "else") ? next : undefined;
    if (afterElse?.name !== "IfStatement") return { branches: branches + (afterElse ? 1 : 0), elseIf, elseBranch: afterElse !== undefined };
    elseIf = true;
    current = afterElse;
  }
  return { branches, elseIf, elseBranch: false };
}

function branchFeatures(source: Source, node: SyntaxNode, functionBody: SyntaxNode | undefined): { has: Set<SiteFeature>; branches: number } {
  const has = new Set<SiteFeature>(["condition"]);
  const inner = descendants(node);
  let branches = inner.filter(({ name }) => name === "CaseStatement").length;
  if (node.name === "IfStatement") {
    const shape = chainShape(node);
    branches = shape.branches;
    if (shape.elseIf) has.add("else-if");
    if (shape.elseBranch) has.add("else-branch");
  }
  if (inner.some((child) => BRANCH_NODES.has(child.name) && !isElseIf(child))) has.add("nested");
  // A return inside a branch ends the function early when statements follow the branch.
  const followed = functionBody !== undefined && source.text.slice(node.to, Math.max(node.to, functionBody.to - 1)).trim() !== "";
  if (followed && inner.some(({ name }) => name === "ReturnStatement")) has.add("early-return");
  const condition = kids(node).find(({ name }) => name === "ConditionClause");
  if (condition && identifiers(source, condition).length > 0) has.add("variable");
  if (isRelational(source, condition)) has.add("relational");
  return { has, branches };
}

function loopParts(node: SyntaxNode): { condition?: SyntaxNode; counter?: SyntaxNode } {
  const parts = kids(node);
  if (node.name === "ForStatement") {
    return {
      condition: parts.find(({ name }) => name === "BinaryExpression"),
      counter: parts.find(({ name }) => name === "Declaration" || name === "AssignmentExpression"),
    };
  }
  return { condition: parts.find(({ name }) => name === "ConditionClause" || name === "ParenthesizedExpression") };
}

const RELATIONAL_OPERATORS = new Set(["<", ">", "<=", ">="]);

/** The condition compares by order, so it has a boundary a value can sit exactly on. */
function isRelational(source: Source, condition: SyntaxNode | undefined): boolean {
  return condition !== undefined && descendants(condition).some((node) => node.name === "CompareOp" && RELATIONAL_OPERATORS.has(source.of(node)));
}

function operatorCount(node: SyntaxNode): number {
  const own = node.name === "BinaryExpression" ? 1 : 0;
  return own + descendants(node).filter(({ name }) => name === "BinaryExpression").length;
}

const FUNCTION_NODE = new Set(["FunctionDefinition"]);

/** Walks the tree once and files every node under the aspects it shows. */
class Collector {
  readonly sites: Collected = Object.fromEntries(ASPECT_IDS.map((id) => [id, [] as Site[]])) as Collected;
  private readonly all: SyntaxNode[];
  private readonly globals = new Set<string>();
  private readonly types = new Set<string>();
  private branchCount = 0;
  private nesting = 0;
  private earlyReturns = 0;
  private calls = 0;
  private stateNames: string[] = [];

  constructor(private readonly source: Source, root: SyntaxNode) {
    this.all = descendants(root);
    for (const node of this.all) this.visit(node);
    this.ownFunctions();
    this.programFlow();
  }

  private add(aspect: AspectId, site: Site): void {
    if (this.sites[aspect].length < MAX_SITES_PER_ASPECT) this.sites[aspect].push(site);
  }

  private functionName(definition: SyntaxNode | null): string | undefined {
    const declarator = definition && kids(definition).find(({ name }) => name === "FunctionDeclarator");
    const id = declarator?.firstChild;
    return id ? this.source.of(id) : undefined;
  }

  private body(definition: SyntaxNode | null): SyntaxNode | undefined {
    return definition ? kids(definition).find(({ name }) => name === "CompoundStatement") : undefined;
  }

  private visit(node: SyntaxNode): void {
    const owner = enclosing(node, FUNCTION_NODE);
    const inFunction = this.functionName(owner);
    if (node.name === "PreprocDirective") this.define(node);
    else if (node.name === "Declaration") this.declaration(node, owner, inFunction);
    else if (node.name === "StructSpecifier") this.struct(node);
    else if (BRANCH_NODES.has(node.name)) this.branch(node, owner, inFunction);
    else if (LOOP_NODES.has(node.name)) this.loop(node, inFunction);
    else if (node.name === "BinaryExpression") this.expression(node, inFunction);
    else if (node.name === "CallExpression") this.call(node, inFunction);
  }

  private define(node: SyntaxNode): void {
    const id = node.firstChild?.name === "#define" ? kids(node).find(({ name }) => name === "Identifier") : undefined;
    if (id) this.add("variables", { node, code: this.source.compact(node), names: [this.source.of(id)], has: new Set(["constant", "initial-value"]) });
  }

  private declaration(node: SyntaxNode, owner: SyntaxNode | null, inFunction: string | undefined): void {
    if (node.parent?.name === "ForStatement") return;
    const type = typeText(this.source, node);
    const kind: SiteFeature = hasKeyword(node, "const") ? "constant" : "variable";
    const code = this.source.compact(node);
    for (const { name, array, initialized } of declaredNames(this.source, node)) {
      if (type) this.types.add(type);
      const has = new Set<SiteFeature>(initialized ? ["type", kind, "initial-value"] : ["type", kind]);
      this.add(array ? "arrays" : "variables", { function: inFunction, node, code, names: [name], has });
      if (owner) this.localScope(node, name, inFunction, code);
      else this.globals.add(name);
    }
  }

  private localScope(node: SyntaxNode, name: string, inFunction: string | undefined, code: string): void {
    if (hasKeyword(node, "static")) this.add("scope", { function: inFunction, node, code, names: [name], has: new Set(["variable", "state"]) });
    if (this.globals.has(name)) this.add("scope", { function: inFunction, node, code, names: [name], has: new Set(["variable"]) });
  }

  private struct(node: SyntaxNode): void {
    const id = node.parent?.name === "Declaration" ? undefined : kids(node).find(({ name }) => name === "TypeIdentifier");
    if (id) this.add("arrays", { node, code: `struct ${this.source.of(id)}`, names: [this.source.of(id)], has: new Set(["type"]) });
  }

  private branch(node: SyntaxNode, owner: SyntaxNode | null, inFunction: string | undefined): void {
    if (isElseIf(node)) return;
    const { has, branches } = branchFeatures(this.source, node, this.body(owner));
    const condition = kids(node).find(({ name }) => name === "ConditionClause");
    this.branchCount += branches;
    if (has.has("nested")) this.nesting++;
    if (has.has("early-return")) this.earlyReturns++;
    this.add("branching", { function: inFunction, node, code: this.source.compact(condition ?? node), names: condition ? identifiers(this.source, condition) : [], has });
  }

  private loop(node: SyntaxNode, inFunction: string | undefined): void {
    const { condition, counter } = loopParts(node);
    const has = new Set<SiteFeature>();
    const counterNames = counter ? identifiers(this.source, counter) : [];
    if (condition) has.add("condition");
    if (isRelational(this.source, condition)) has.add("relational");
    if (counter) has.add("counter");
    if (condition && identifiers(this.source, condition).some((name) => !counterNames.includes(name))) has.add("bound");
    const inner = descendants(node);
    if (inner.some(({ name }) => LOOP_NODES.has(name))) has.add("nested");
    if (inner.some(({ name }) => name === "SubscriptExpression")) has.add("index");
    this.add("loops", { function: inFunction, node, code: this.source.compact(condition ?? node), names: identifiers(this.source, condition ?? node), has });
  }

  private expression(node: SyntaxNode, inFunction: string | undefined): void {
    const outermost = node.parent?.name !== "BinaryExpression" && node.parent?.name !== "ParenthesizedExpression";
    if (!outermost || operatorCount(node) < 2) return;
    this.add("expressions", { function: inFunction, node, code: this.source.compact(node), names: identifiers(this.source, node), has: new Set(["variable"]) });
  }

  private call(node: SyntaxNode, inFunction: string | undefined): void {
    const callee = calleeName(this.source, node);
    const args = kids(node).find(({ name }) => name === "ArgumentList");
    const site = { function: inFunction, node, code: this.source.compact(node), names: args ? identifiers(this.source, args) : [] };
    if (PIN_CALLS.has(callee)) this.add("pins", { ...site, has: new Set(["pin", PIN_INPUT_CALLS.has(callee) ? "input" : "output"]) });
    if (TIMING_CALLS.has(callee)) this.add("timing", { ...site, has: new Set(callee.startsWith("delay") ? [] : ["interval"]) });
    if (callee.startsWith("Serial.")) this.add("serial", { ...site, has: serialFeatures(callee, site.names) });
  }

  private ownFunctions(): void {
    for (const definition of this.all.filter(({ name }) => name === "FunctionDefinition")) {
      const name = this.functionName(definition);
      if (!name || ENTRY_FUNCTIONS.has(name)) continue;
      const declarator = kids(definition).find((child) => child.name === "FunctionDeclarator");
      const has = new Set<SiteFeature>();
      if (declarator && descendants(declarator).some((child) => child.name === "ParameterDeclaration")) has.add("parameter");
      if (typeText(this.source, definition) !== "void") has.add("return-value");
      const called = this.all.filter((node) => node.name === "CallExpression" && calleeName(this.source, node) === name).length;
      if (called > 0) has.add("call");
      this.calls += called;
      const code = declarator ? `${typeText(this.source, definition)} ${this.source.compact(declarator)}`.trim() : name;
      this.add("functions", { function: name, node: definition, code, names: [name], has });
    }
  }

  /** A global written in loop() keeps its value over the passes: the state of the program. */
  private writtenGlobals(loopBody: SyntaxNode): string[] {
    const written = descendants(loopBody)
      .filter(({ name }) => name === "AssignmentExpression" || name === "UpdateExpression")
      .map((node) => (node.firstChild?.name === "Identifier" ? node.firstChild : node.lastChild))
      .flatMap((target) => (target?.name === "Identifier" ? [this.source.of(target)] : []));
    return [...new Set(written.filter((name) => this.globals.has(name)))];
  }

  private programFlow(): void {
    const entries = this.all.filter((node) => node.name === "FunctionDefinition" && ENTRY_FUNCTIONS.has(this.functionName(node) ?? ""));
    const loopBody = this.body(entries.find((definition) => this.functionName(definition) === "loop") ?? null);
    this.stateNames = loopBody ? this.writtenGlobals(loopBody) : [];
    for (const definition of entries) {
      const name = this.functionName(definition) ?? "";
      const state = name === "loop" && this.stateNames.length > 0;
      this.add("program-flow", { function: name, node: definition, code: `void ${name}()`, names: state ? this.stateNames : [], has: new Set(state ? ["state"] : []) });
    }
  }

  weights(): Record<AspectId, number> {
    const { sites } = this;
    const count = (aspect: AspectId, cap: number) => Math.min(sites[aspect].length, cap);
    const any = (aspect: AspectId, feature: SiteFeature) => sites[aspect].some(({ has }) => has.has(feature));
    const bonus = (condition: boolean, value: number) => (condition ? value : 0);
    /** Zero for an aspect the sketch does not show, whatever its bonuses add up to. */
    const present = (aspect: AspectId, weight: number) => bonus(sites[aspect].length > 0, weight);
    return {
      variables: present("variables", count("variables", 6) + Math.min(this.types.size, 4)),
      expressions: count("expressions", 4) * 2,
      branching: this.branchCount * 3 + this.nesting * 2 + this.earlyReturns * 3,
      loops: count("loops", 4) * 4 + bonus(any("loops", "nested"), 2) + bonus(any("loops", "bound"), 2),
      functions: count("functions", 4) * 3 + Math.min(this.calls, 3) + bonus(any("functions", "parameter"), 2) + bonus(any("functions", "return-value"), 2),
      arrays: count("arrays", 3) * 3 + bonus(any("loops", "index"), 3),
      scope: count("scope", 3) * 3,
      serial: present("serial", count("serial", 3) + bonus(any("serial", "output-value"), 2) + bonus(any("serial", "input"), 3)),
      pins: present("pins", count("pins", 4) + bonus(any("pins", "input") && any("pins", "output"), 3)),
      timing: present("timing", 1 + count("timing", 2) + bonus(any("timing", "interval"), 5)),
      "program-flow": present("program-flow", 2 + bonus(this.stateNames.length > 0, 4)),
    };
  }
}

function serialFeatures(callee: string, argumentNames: readonly string[]): Set<SiteFeature> {
  if (SERIAL_INPUT_CALLS.has(callee.slice("Serial.".length))) return new Set(["input"]);
  return new Set(argumentNames.length > 0 ? ["output-value"] : []);
}

function publicSites(source: Source, aspect: AspectId, sites: readonly Site[]): AspectSite[] {
  const seen = new Map<string, number>();
  return sites.map(({ function: inFunction, node, code, names, has }) => {
    const base = `${aspect}:${inFunction ?? ""}:${code}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {
      id: occurrence === 1 ? base : `${base}#${occurrence}`,
      ...(inFunction ? { function: inFunction } : {}),
      line: source.line(node.from),
      endLine: source.line(Math.max(node.from, node.to - 1)),
      code,
      names,
      has: SITE_FEATURES.filter((feature) => has.has(feature)),
    };
  });
}

/**
 * The aspects found in the sketch, heaviest first; aspects of equal weight keep the order of `ASPECT_IDS`.
 * A sketch that is too large or cannot be parsed yields no aspects.
 */
export function detectAspects(code: string): DetectedAspect[] {
  if (code.length > MAX_SOURCE_CHARS) return [];
  const source = new Source(code);
  const collector = new Collector(source, parser.parse(code).topNode);
  const { sites } = collector;
  const weights = collector.weights();
  return ASPECT_IDS
    .filter((id) => weights[id] > 0 && sites[id].length > 0)
    .map((id) => ({ id, weight: weights[id], sites: publicSites(source, id, sites[id]) }))
    .sort((left, right) => right.weight - left.weight);
}

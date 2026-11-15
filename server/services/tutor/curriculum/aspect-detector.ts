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
  "condition", "variable", "constant", "type", "initial-value", "else-branch", "else-if", "early-return", "nested",
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

function branchFeatures(source: Source, node: SyntaxNode, functionBody: SyntaxNode | undefined): { has: Set<SiteFeature>; branches: number } {
  const has = new Set<SiteFeature>(["condition"]);
  let branches = 0;
  if (node.name === "SwitchStatement") {
    branches = descendants(node).filter(({ name }) => name === "CaseStatement").length;
  } else {
    for (let current: SyntaxNode | null = node; current; ) {
      branches++;
      const parts = kids(current);
      const elseIndex = parts.findIndex(({ name }) => name === "else");
      const next = elseIndex >= 0 ? parts[elseIndex + 1] : undefined;
      if (!next) break;
      if (next.name === "IfStatement") {
        has.add("else-if");
        current = next;
      } else {
        has.add("else-branch");
        branches++;
        current = null;
      }
    }
  }
  const inner = descendants(node);
  if (inner.some((child) => BRANCH_NODES.has(child.name) && !isElseIf(child))) has.add("nested");
  // A return inside a branch ends the function early when statements follow the branch.
  const followed = functionBody !== undefined && node.to < functionBody.to - 1 && source.text.slice(node.to, functionBody.to - 1).trim() !== "";
  if (followed && inner.some(({ name }) => name === "ReturnStatement")) has.add("early-return");
  const condition = kids(node).find(({ name }) => name === "ConditionClause");
  if (condition && identifiers(source, condition).length > 0) has.add("variable");
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

function operatorCount(node: SyntaxNode): number {
  const own = node.name === "BinaryExpression" ? 1 : 0;
  return own + descendants(node).filter(({ name }) => name === "BinaryExpression").length;
}

function collect(source: Source, root: SyntaxNode): { sites: Collected; weights: Record<AspectId, number> } {
  const sites: Collected = Object.fromEntries(ASPECT_IDS.map((id) => [id, [] as Site[]])) as Collected;
  const add = (aspect: AspectId, site: Site) => {
    if (sites[aspect].length < MAX_SITES_PER_ASPECT) sites[aspect].push(site);
  };
  const all = descendants(root);
  const functions = all.filter(({ name }) => name === "FunctionDefinition");
  const functionOf = (node: SyntaxNode) => enclosing(node, new Set(["FunctionDefinition"]));
  const nameOfFunction = (definition: SyntaxNode | null): string | undefined => {
    const declarator = definition && kids(definition).find(({ name }) => name === "FunctionDeclarator");
    const id = declarator?.firstChild;
    return id ? source.of(id) : undefined;
  };
  const bodyOf = (definition: SyntaxNode | null) => (definition ? kids(definition).find(({ name }) => name === "CompoundStatement") : undefined);

  // Variables, constants, arrays, scope
  const globals = new Set<string>();
  const types = new Set<string>();
  let branchCount = 0;
  let nesting = 0;
  let earlyReturns = 0;
  for (const node of all) {
    const owner = functionOf(node);
    const inFunction = nameOfFunction(owner);
    if (node.name === "PreprocDirective" && node.firstChild?.name === "#define") {
      const id = kids(node).find(({ name }) => name === "Identifier");
      if (id) add("variables", { node, code: source.compact(node), names: [source.of(id)], has: new Set(["constant", "initial-value"]) });
    }
    if (node.name === "Declaration" && node.parent?.name !== "ForStatement") {
      const type = typeText(source, node);
      const constant = hasKeyword(node, "const");
      for (const { name, array, initialized } of declaredNames(source, node)) {
        if (type) types.add(type);
        if (!owner) globals.add(name);
        const has = new Set<SiteFeature>(["type", constant ? "constant" : "variable"]);
        if (initialized) has.add("initial-value");
        add(array ? "arrays" : "variables", { function: inFunction, node, code: source.compact(node), names: [name], has });
        if (owner && hasKeyword(node, "static")) add("scope", { function: inFunction, node, code: source.compact(node), names: [name], has: new Set(["variable", "state"]) });
        if (owner && globals.has(name)) add("scope", { function: inFunction, node, code: source.compact(node), names: [name], has: new Set(["variable"]) });
      }
    }
    if (node.name === "StructSpecifier" && node.parent?.name !== "Declaration") {
      const id = kids(node).find(({ name }) => name === "TypeIdentifier");
      if (id) add("arrays", { node, code: `struct ${source.of(id)}`, names: [source.of(id)], has: new Set(["type"]) });
    }
    if (BRANCH_NODES.has(node.name) && !isElseIf(node)) {
      const { has, branches } = branchFeatures(source, node, bodyOf(owner));
      const condition = kids(node).find(({ name }) => name === "ConditionClause");
      branchCount += branches;
      if (has.has("nested")) nesting++;
      if (has.has("early-return")) earlyReturns++;
      add("branching", { function: inFunction, node, code: source.compact(condition ?? node), names: condition ? identifiers(source, condition) : [], has });
    }
    if (LOOP_NODES.has(node.name)) {
      const { condition, counter } = loopParts(node);
      const has = new Set<SiteFeature>();
      if (condition) has.add("condition");
      if (counter) has.add("counter");
      if (condition && identifiers(source, condition).some((name) => !counter || !identifiers(source, counter).includes(name))) has.add("bound");
      const inner = descendants(node);
      if (inner.some(({ name }) => LOOP_NODES.has(name))) has.add("nested");
      if (inner.some(({ name }) => name === "SubscriptExpression")) has.add("index");
      add("loops", { function: inFunction, node, code: source.compact(condition ?? node), names: identifiers(source, condition ?? node), has });
    }
    if (node.name === "BinaryExpression" && node.parent?.name !== "BinaryExpression" && node.parent?.name !== "ParenthesizedExpression" && operatorCount(node) >= 2) {
      add("expressions", { function: inFunction, node, code: source.compact(node), names: identifiers(source, node), has: new Set(["variable"]) });
    }
    if (node.name === "CallExpression") {
      const callee = calleeName(source, node);
      const args = kids(node).find(({ name }) => name === "ArgumentList");
      const argNames = args ? identifiers(source, args) : [];
      if (PIN_CALLS.has(callee)) {
        add("pins", { function: inFunction, node, code: source.compact(node), names: argNames, has: new Set(["pin", PIN_INPUT_CALLS.has(callee) ? "input" : "output"]) });
      }
      if (TIMING_CALLS.has(callee)) {
        const compared = callee !== "delay" && callee !== "delayMicroseconds";
        add("timing", { function: inFunction, node, code: source.compact(node), names: argNames, has: new Set(compared ? ["interval"] : []) });
      }
      if (callee.startsWith("Serial.")) {
        const has = new Set<SiteFeature>();
        if (SERIAL_INPUT_CALLS.has(callee.slice("Serial.".length))) has.add("input");
        else if (argNames.length > 0) has.add("output-value");
        add("serial", { function: inFunction, node, code: source.compact(node), names: argNames, has });
      }
    }
  }

  // Own functions
  let calls = 0;
  for (const definition of functions) {
    const name = nameOfFunction(definition);
    if (!name || ENTRY_FUNCTIONS.has(name)) continue;
    const declarator = kids(definition).find((child) => child.name === "FunctionDeclarator");
    const has = new Set<SiteFeature>();
    if (declarator && descendants(declarator).some((child) => child.name === "ParameterDeclaration")) has.add("parameter");
    if (typeText(source, definition) !== "void") has.add("return-value");
    const called = all.filter((node) => node.name === "CallExpression" && calleeName(source, node) === name).length;
    if (called > 0) has.add("call");
    calls += called;
    add("functions", { function: name, node: definition, code: declarator ? `${typeText(source, definition)} ${source.compact(declarator)}`.trim() : name, names: [name], has });
  }

  // Globals written in loop() keep their value over the passes: the state of the program.
  const loopBody = bodyOf(functions.find((definition) => nameOfFunction(definition) === "loop") ?? null);
  const stateNames = loopBody
    ? [...new Set(descendants(loopBody)
      .filter(({ name }) => name === "AssignmentExpression" || name === "UpdateExpression")
      .flatMap((node) => (node.firstChild?.name === "Identifier" ? [source.of(node.firstChild)] : node.lastChild?.name === "Identifier" ? [source.of(node.lastChild)] : []))
      .filter((name) => globals.has(name)))]
    : [];
  for (const definition of functions) {
    const name = nameOfFunction(definition);
    if (name && ENTRY_FUNCTIONS.has(name)) {
      add("program-flow", { function: name, node: definition, code: `void ${name}()`, names: name === "loop" ? stateNames : [], has: new Set(name === "loop" && stateNames.length > 0 ? ["state"] : []) });
    }
  }

  const count = (aspect: AspectId, cap: number) => Math.min(sites[aspect].length, cap);
  const any = (aspect: AspectId, feature: SiteFeature) => sites[aspect].some(({ has }) => has.has(feature));
  const inputSteersOutput = any("pins", "input") && any("pins", "output");
  const weights: Record<AspectId, number> = {
    variables: sites.variables.length === 0 ? 0 : count("variables", 6) + Math.min(types.size, 4),
    expressions: count("expressions", 4) * 2,
    branching: branchCount * 3 + nesting * 2 + earlyReturns * 3,
    loops: count("loops", 4) * 4 + (any("loops", "nested") ? 2 : 0) + (any("loops", "bound") ? 2 : 0),
    functions: count("functions", 4) * 3 + Math.min(calls, 3) + (any("functions", "parameter") ? 2 : 0) + (any("functions", "return-value") ? 2 : 0),
    arrays: count("arrays", 3) * 3 + (sites.loops.some(({ has }) => has.has("index")) ? 3 : 0),
    scope: count("scope", 3) * 3,
    serial: sites.serial.length === 0 ? 0 : count("serial", 3) + (any("serial", "output-value") ? 2 : 0) + (any("serial", "input") ? 3 : 0),
    pins: sites.pins.length === 0 ? 0 : count("pins", 4) + (inputSteersOutput ? 3 : 0),
    timing: sites.timing.length === 0 ? 0 : 1 + count("timing", 2) + (any("timing", "interval") ? 5 : 0),
    "program-flow": sites["program-flow"].length === 0 ? 0 : 2 + (stateNames.length > 0 ? 4 : 0),
  };
  return { sites, weights };
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
  const root = parser.parse(code).topNode;
  const { sites, weights } = collect(source, root);
  return ASPECT_IDS
    .filter((id) => weights[id] > 0 && sites[id].length > 0)
    .map((id) => ({ id, weight: weights[id], sites: publicSites(source, id, sites[id]) }))
    .sort((left, right) => right.weight - left.weight);
}

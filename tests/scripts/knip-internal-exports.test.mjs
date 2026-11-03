import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * `@internal` marks an export that only tests use because it needs module state
 * (singleton and cache resets, test logging, a store observer). Knip's
 * production profile skips it; the full profile still reports it once no test
 * uses it. This is a bounded exception: exactly these seven hooks, each with a
 * reason. The guard reads the TypeScript AST and accepts the tag only on a
 * named `export function` or a single-name `export const`; every other place
 * of the tag, and any re-export of a hook, fails.
 */
const REVIEWED_INTERNAL_EXPORTS = {
  "client/src/lib/external-examples.ts": ["getExternalExamplesState"], // observes the module store without rendering
  "client/src/lib/runtime/runtime-config.ts": ["resetRuntimeConfigCache"], // per-page-view cache
  "server/services/sandbox-runner-pool.ts": ["_resetPoolSingleton"], // pool singleton, re-initialized with new env
  "server/services/unified-gatekeeper.ts": ["resetUnifiedGatekeeper"], // gatekeeper singleton and its lock monitor
  "shared/logger.ts": ["initializeGlobalErrorHandlers", "markTestAsFailed", "setLogLevel"], // tests/setup*.ts and logger tests
};
const REVIEWED_NAMES = new Set(Object.values(REVIEWED_INTERNAL_EXPORTS).flat());
const REVIEWED_MODULES = new Set(Object.keys(REVIEWED_INTERNAL_EXPORTS).map((file) => file.replace(/\.[^./]+$/, "")));

const SOURCE_ROOTS = ["client/src", "server", "shared", "scripts", "packages/avr-emulator/src"];
const TAG = /@internal\b/g;

const hasModifier = (node, kind) => ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;

/** The exported name of a statement the tag may sit on, or undefined for any other form. */
function reviewableName(statement) {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return undefined;
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text;
  if (ts.isVariableStatement(statement)) {
    const [only, ...more] = statement.declarationList.declarations;
    return more.length === 0 && ts.isIdentifier(only.name) ? only.name.text : undefined;
  }
  return undefined;
}

/** Re-exports of a reviewed hook: by name from any module, or everything from a reviewed module. */
function reExportProblem(fileName, statement) {
  if (!ts.isExportDeclaration(statement)) return undefined;
  if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    const names = statement.exportClause.elements.map((element) => (element.propertyName ?? element.name).text);
    return names.some((name) => REVIEWED_NAMES.has(name)) ? "re-exports a reviewed @internal hook" : undefined;
  }
  const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
  const target = relative(root, resolve(dirname(fileName), specifier)).replace(/\.[^./]+$/, "");
  return specifier.startsWith(".") && REVIEWED_MODULES.has(target) ? "re-exports a module with reviewed @internal hooks" : undefined;
}

/** Names tagged `@internal` in one source file, and every place of the tag the guard does not accept. */
function inspect(fileName, text) {
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const names = [];
  const problems = [];
  let placed = 0;
  const at = (node) => `${relative(root, fileName)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  for (const statement of source.statements) {
    const reExport = reExportProblem(fileName, statement);
    if (reExport) problems.push(`${at(statement)} ${reExport}`);
    const tags = ts.getJSDocTags(statement).filter((tag) => tag.tagName.text === "internal");
    if (tags.length === 0) continue;
    placed += tags.length;
    const name = reviewableName(statement);
    if (name !== undefined && tags.length === 1) names.push(name);
    else problems.push(`${at(statement)} @internal only on a named export function or a single export const, once`);
  }
  const total = text.match(TAG)?.length ?? 0;
  if (total !== placed) problems.push(`${relative(root, fileName)}: ${total - placed} @internal outside the JSDoc of a top-level declaration`);
  return { names: names.sort(), problems };
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* sourceFiles(path);
    } else if (/\.(?:ts|tsx|mjs|cjs)$/.test(entry.name)) {
      yield path;
    }
  }
}

test("only the reviewed test hooks are exported as @internal, in an accepted form", () => {
  const found = {};
  const problems = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    for (const file of sourceFiles(join(root, sourceRoot))) {
      const result = inspect(file, readFileSync(file, "utf8"));
      if (result.names.length > 0) found[relative(root, file)] = result.names;
      problems.push(...result.problems);
    }
  }
  assert.deepEqual(problems, []);
  assert.deepEqual(found, REVIEWED_INTERNAL_EXPORTS);
});

test("rejects @internal on forms the guard does not review", async (t) => {
  const rejected = {
    "a default function export": "/** @internal */\nexport default function unreviewedTestOnlyExport() {\n  return 42;\n}\n",
    "a default value export": "const value = 1;\n/** @internal */\nexport default value;\n",
    "a named re-export": '/** @internal */\nexport { helper } from "./helper";\n',
    "a local export list": "/** @internal */\nfunction hidden() {}\nexport { hidden };\n",
    "a multiple declaration": "/** @internal */\nexport const first = 1, second = 2;\n",
    "a class": "/** @internal */\nexport class Fixture {}\n",
    "a tag outside a declaration's JSDoc": "export function visible() {\n  /** @internal */\n  const inner = 1;\n  return inner;\n}\n",
    "two tags on one export": "/** @internal */\n/** @internal */\nexport function twice() {}\n",
  };
  for (const [name, source] of Object.entries(rejected)) {
    await t.test(name, () => {
      assert.notDeepEqual(inspect("fixture.ts", source).problems, []);
    });
  }
});

test("accepts a named function or single const export with one @internal tag", () => {
  const source = "/**\n * Resets the cache.\n * @internal\n */\nexport function reset() {}\n/** @internal */\nexport const observe = () => 0;\n";
  assert.deepEqual(inspect("fixture.ts", source), { names: ["observe", "reset"], problems: [] });
});

test("rejects re-exporting a reviewed hook under another module", async (t) => {
  const cases = {
    "a named re-export": 'export { resetRuntimeConfigCache as reset } from "./runtime/runtime-config";\n',
    "a star re-export": 'export * from "./runtime/runtime-config";\n',
  };
  for (const [name, source] of Object.entries(cases)) {
    await t.test(name, () => {
      assert.notDeepEqual(inspect(join(root, "client/src/lib/index.ts"), source).problems, []);
    });
  }
});

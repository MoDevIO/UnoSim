import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const knip = join(root, "node_modules/knip/bin/knip.js");

test("Knip distinguishes production use from use exclusively in tests", async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "unosim-knip-production-"));
  const files = {
    "package.json": JSON.stringify({
      name: "usage-fixture", private: true, type: "module", workspaces: ["packages/*"],
      devDependencies: { vitest: "4.1.0", typescript: "5.6.3" },
      scripts: {
        start: "node server/index.ts",
        build: "esbuild client/src/main.tsx --outdir=dist",
        "build:worker": "esbuild server/services/workers/compile-worker.ts --outdir=dist",
        emulate: "node scripts/emulate.ts",
      },
    }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler" } }),
    "vitest.config.ts": 'export default { test: { include: ["tests/**/*.test.ts"] } };',
    "client/src/main.tsx": 'import { active } from "../../shared/mixed"; console.log(active());',
    "server/index.ts": 'import { active } from "../shared/mixed"; console.log(active());',
    "shared/mixed.ts": [
      "export const active = () => 1;",
      "export const testOnlyExport = () => 2;",
      "export type TestOnlyShape = { value: number };",
      "/** Test hook. @internal */",
      "export const resetForTests = () => 0;",
      "/** @internal */",
      "export const unusedTestHook = () => 0;",
    ].join("\n"),
    "client/src/hooks/use-retired.ts": "export const useRetired = () => 3;",
    "shared/worker-protocol.ts": [
      "export const compileMessage = () => 4;",
      "export const testOnlyProtocolHelper = () => 5;",
    ].join("\n"),
    "server/services/workers/compile-worker.ts": 'import { compileMessage } from "../../../shared/worker-protocol"; console.log(compileMessage());',
    "scripts/emulate.ts": 'import { toolingHelper } from "../server/tooling-helper"; console.log(toolingHelper());',
    "server/tooling-helper.ts": "export const toolingHelper = () => 6;",
    "tests/shared/usage.test.ts": [
      'import { resetForTests, testOnlyExport, type TestOnlyShape } from "../../shared/mixed";',
      'import { useRetired } from "../../client/src/hooks/use-retired";',
      'import { testOnlyProtocolHelper } from "../../shared/worker-protocol";',
      "const shape: TestOnlyShape = { value: testOnlyExport() };",
      "console.log(shape, useRetired(), testOnlyProtocolHelper(), resetForTests());",
    ].join("\n"),
    "packages/avr-emulator/package.json": JSON.stringify({
      name: "@unosim/avr-emulator", private: true, type: "module",
      exports: { ".": "./src/index.ts" },
    }),
    // Public package exports stay live even without an application consumer.
    "packages/avr-emulator/src/index.ts": 'export { publicBoard } from "./board";',
    "packages/avr-emulator/src/board.ts": "export const publicBoard = () => 7;",
  };
  for (const [name, source] of Object.entries(files)) {
    const file = join(fixture, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  copyFileSync(join(root, "knip.json"), join(fixture, "knip.json"));

  function analyze(production) {
    const result = spawnSync(process.execPath, [
      knip, "--config", "knip.json",
      "--include", "files,exports,types,enumMembers,namespaceMembers", "--reporter", "json",
      "--no-config-hints", ...(production ? ["--production"] : []),
    ], { cwd: fixture, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.error, undefined);
    assert.ok(result.status === 0 || result.status === 1, result.stdout + result.stderr);
    return JSON.parse(result.stdout).issues;
  }

  try {
    const normal = analyze(false);
    const production = analyze(true);
    const finding = (file, category, name) => production.find(issue => issue.file === file)?.[category]?.some(item => item.name === name);

    await t.test("the full graph sees imports from test files and still reports an unused @internal export", () => {
      assert.deepEqual(normal.map(issue => [issue.file, issue.exports.map(item => item.name)]), [["shared/mixed.ts", ["unusedTestHook"]]]);
    });
    await t.test("test imports do not keep a retired production file alive", () => {
      assert.ok(finding("client/src/hooks/use-retired.ts", "files", "client/src/hooks/use-retired.ts"));
    });
    await t.test("test imports do not keep individual exports and types alive in an active module", () => {
      assert.ok(finding("shared/mixed.ts", "exports", "testOnlyExport"));
      assert.ok(finding("shared/mixed.ts", "types", "TestOnlyShape"));
    });
    await t.test("an @internal test hook is no production finding", () => {
      assert.ok(!finding("shared/mixed.ts", "exports", "resetForTests"));
      assert.ok(!finding("shared/mixed.ts", "exports", "unusedTestHook"));
    });
    await t.test("an internal protocol module is not a blanket public entry point", () => {
      assert.ok(finding("shared/worker-protocol.ts", "exports", "testOnlyProtocolHelper"));
    });
    await t.test("browser, server, worker, CLI dependencies and public package exports stay reachable", () => {
      assert.deepEqual(production.map(issue => issue.file).sort(), [
        "client/src/hooks/use-retired.ts", "shared/mixed.ts", "shared/worker-protocol.ts",
      ]);
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

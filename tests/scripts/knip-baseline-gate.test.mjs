import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const expectedFinding = "Unused exports :: candidateName server/services/example.ts";
const knipFindingOutput = "Unused exports (1)\n  candidateName server/services/example.ts:1:1";

function runGate({ baselineContent, knipOutput = "", knipStatus = 0,
  productionBaseline = "# no reviewed production findings\n", productionOutput = "", productionStatus = 0 }) {
  const testRoot = mkdtempSync(join(tmpdir(), "unosim-knip-gate-test-"));
  const fakeBin = join(testRoot, "bin");
  const baselinePath = join(testRoot, "knip-baseline.txt");
  const productionBaselinePath = join(testRoot, "knip-production-baseline.txt");
  const callsPath = join(testRoot, "calls.txt");
  const testScript = join(testRoot, "run-tests.sh");

  mkdirSync(fakeBin);
  copyFileSync(join(repositoryRoot, "run-tests.sh"), testScript);
  copyFileSync(join(repositoryRoot, ".nvmrc"), join(testRoot, ".nvmrc"));
  writeFileSync(join(testRoot, "check-leaks.sh"), '#!/bin/sh\nprintf "check-leaks\\n" >> "$KNIP_TEST_CALLS"\n');
  chmodSync(join(testRoot, "check-leaks.sh"), 0o755);

  if (baselineContent !== undefined) writeFileSync(baselinePath, baselineContent);
  if (productionBaseline !== null) writeFileSync(productionBaselinePath, productionBaseline);

  const stubs = {
    clear: 'printf "clear\\n" >> "$KNIP_TEST_CALLS"',
    docker: 'printf "docker\\n" >> "$KNIP_TEST_CALLS"\nexit 1',
    lsof: 'printf "lsof\\n" >> "$KNIP_TEST_CALLS"\nexit 1',
    npm: 'printf "npm\\n" >> "$KNIP_TEST_CALLS"\nexit 0',
    npx: [
      'if [ "$#" -eq 5 ] && [ "$1" = knip ] && [ "$2" = --no-config-hints ] && [ "$3" = --production ] && [ "$4" = --include ] && [ "$5" = files,exports,types,nsExports,nsTypes,enumMembers,namespaceMembers,duplicates,unresolved ]; then',
      '  printf "npx-production\\n" >> "$KNIP_TEST_CALLS"',
      '  printf "%s\\n" "$KNIP_PRODUCTION_STUB_OUTPUT"',
      '  exit "$KNIP_PRODUCTION_STUB_STATUS"',
      'fi',
      'printf "npx\\n" >> "$KNIP_TEST_CALLS"',
      '[ "$#" -eq 2 ] && [ "$1" = knip ] && [ "$2" = --no-config-hints ] || exit 99',
      'printf "%s\\n" "$KNIP_STUB_OUTPUT"',
      'exit "$KNIP_STUB_STATUS"',
    ].join("\n"),
  };

  for (const [name, body] of Object.entries(stubs)) {
    const stubPath = join(fakeBin, name);
    writeFileSync(stubPath, `#!/bin/sh\n${body}\n`);
    chmodSync(stubPath, 0o755);
  }

  const env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    KNIP_BASELINE_FILE: baselinePath,
    KNIP_PRODUCTION_BASELINE_FILE: productionBaselinePath,
    KNIP_TEST_CALLS: callsPath,
    KNIP_STUB_OUTPUT: knipOutput,
    KNIP_STUB_STATUS: String(knipStatus),
    KNIP_PRODUCTION_STUB_OUTPUT: productionOutput,
    KNIP_PRODUCTION_STUB_STATUS: String(productionStatus),
    SONAR_TOKEN: "",
  };

  try {
    const result = spawnSync("bash", [testScript, "--knip-gate-only"], {
      cwd: testRoot,
      encoding: "utf8",
      env,
      timeout: 10_000,
    });
    const calls = existsSync(callsPath) ? readFileSync(callsPath, "utf8").trim().split("\n") : [];
    return { ...result, calls, testRoot };
  } catch (error) {
    rmSync(testRoot, { recursive: true, force: true });
    throw error;
  }
}

test("Knip gate-only mode validates baselines and compares actual Knip output", async (t) => {
  await t.test("A: comment-only baseline passes with zero counts", () => {
    const result = runGate({ baselineContent: "# reviewed baseline\n\n# no findings\n" });
    try {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /new: 0, baseline: 0, resolved: 0/);
      assert.deepEqual(result.calls, ["npx", "npx-production"]);
    } finally {
      rmSync(result.testRoot, { recursive: true, force: true });
    }
  });

  await t.test("B: a Knip finding absent from an empty baseline fails", () => {
    const result = runGate({ baselineContent: "# empty\n", knipOutput: knipFindingOutput, knipStatus: 1 });
    try {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /1 new finding\(s\)/);
      assert.ok(result.stdout.includes(expectedFinding));
      assert.deepEqual(result.calls, ["npx"]);
    } finally {
      rmSync(result.testRoot, { recursive: true, force: true });
    }
  });

  await t.test("C: a valid known finding remains an accepted baseline record", () => {
    const result = runGate({
      baselineContent: `# one known finding\n${expectedFinding}\n`,
      knipOutput: knipFindingOutput,
      knipStatus: 1,
    });
    try {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /new: 0, baseline: 1, resolved: 0/);
      assert.deepEqual(result.calls, ["npx", "npx-production"]);
    } finally {
      rmSync(result.testRoot, { recursive: true, force: true });
    }
  });

  await t.test("D: a malformed non-empty baseline fails before invoking Knip", () => {
    const result = runGate({ baselineContent: "not a normalized Knip record\n" });
    try {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /invalid baseline/);
      assert.deepEqual(result.calls, []);
    } finally {
      rmSync(result.testRoot, { recursive: true, force: true });
    }
  });

  await t.test("E: a missing baseline fails before invoking Knip", () => {
    const result = runGate({});
    try {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /baseline missing or unreadable/);
      assert.deepEqual(result.calls, []);
    } finally {
      rmSync(result.testRoot, { recursive: true, force: true });
    }
  });
});

test("production findings are not hidden by a successful full-graph check", () => {
  const result = runGate({
    baselineContent: "# empty\n", productionStatus: 1,
    productionOutput: "Unused files (1)\nclient/src/hooks/use-retired.ts\n",
  });
  try {
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /Profile: production/);
    assert.match(result.stdout, /1 new finding/);
    assert.match(result.stdout, /Unused files :: client\/src\/hooks\/use-retired.ts/);
    assert.deepEqual(result.calls, ["npx", "npx-production"]);
  } finally { rmSync(result.testRoot, { recursive: true, force: true }); }
});

test("a missing production baseline fails after the full graph passes", () => {
  const result = runGate({ baselineContent: "# empty\n", productionBaseline: null });
  try {
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /baseline missing or unreadable/);
    assert.match(result.stdout, /knip-production-baseline/);
    assert.deepEqual(result.calls, ["npx"]);
  } finally { rmSync(result.testRoot, { recursive: true, force: true }); }
});

test("reviewed production files and enum members stay visible and new members still fail", () => {
  const baseline = [
    "# reviewed: retired adapter, cleanup tracked separately",
    "Unused files :: client/src/hooks/use-retired.ts",
    "Unused exported enum members :: LOW TaskPriority server/services/example.ts",
  ].join("\n");
  for (const member of ["LOW", "HIGH"]) {
    const result = runGate({
      baselineContent: "# empty\n", productionBaseline: baseline, productionStatus: 1,
      productionOutput: `Unused files (1)\nclient/src/hooks/use-retired.ts\nUnused exported enum members (1)\n${member} TaskPriority server/services/example.ts:5:2\n`,
    });
    try {
      assert.equal(result.status, member === "LOW" ? 0 : 1, result.stdout + result.stderr);
      if (member === "LOW") {
        assert.match(result.stdout, /new: 0, baseline: 2, resolved: 0/);
        assert.match(result.stdout, /Reviewed production findings remain/);
        assert.match(result.stdout, /Unused files :: client\/src\/hooks\/use-retired.ts/);
      } else {
        assert.match(result.stdout, /1 new finding/);
        assert.match(result.stdout, /HIGH TaskPriority/);
      }
    } finally { rmSync(result.testRoot, { recursive: true, force: true }); }
  }
});

test("production errors and inconsistent output fail closed", () => {
  for (const [productionStatus, productionOutput] of [
    [2, ""], [0, "Unused files (1)\nclient/src/example.ts\n"],
    [1, "Unused files (2)\nclient/src/example.ts\n"], [0, "unexpected diagnostic"],
  ]) {
    const result = runGate({ baselineContent: "# empty\n", productionStatus, productionOutput });
    try {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /FAIL:/);
    } finally { rmSync(result.testRoot, { recursive: true, force: true }); }
  }
});

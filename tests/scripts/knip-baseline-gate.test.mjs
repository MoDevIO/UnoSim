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

function runGate({ baselineContent, knipOutput = "", knipStatus = 0 }) {
  const testRoot = mkdtempSync(join(tmpdir(), "unosim-knip-gate-test-"));
  const fakeBin = join(testRoot, "bin");
  const baselinePath = join(testRoot, "knip-baseline.txt");
  const callsPath = join(testRoot, "calls.txt");
  const testScript = join(testRoot, "run-tests.sh");

  mkdirSync(fakeBin);
  copyFileSync(join(repositoryRoot, "run-tests.sh"), testScript);
  copyFileSync(join(repositoryRoot, ".nvmrc"), join(testRoot, ".nvmrc"));
  writeFileSync(join(testRoot, "check-leaks.sh"), '#!/bin/sh\nprintf "check-leaks\\n" >> "$KNIP_TEST_CALLS"\n');
  chmodSync(join(testRoot, "check-leaks.sh"), 0o755);

  if (baselineContent !== undefined) writeFileSync(baselinePath, baselineContent);

  const stubs = {
    clear: 'printf "clear\\n" >> "$KNIP_TEST_CALLS"',
    docker: 'printf "docker\\n" >> "$KNIP_TEST_CALLS"\nexit 1',
    lsof: 'printf "lsof\\n" >> "$KNIP_TEST_CALLS"\nexit 1',
    npm: 'printf "npm\\n" >> "$KNIP_TEST_CALLS"\nexit 0',
    npx: [
      'printf "npx\\n" >> "$KNIP_TEST_CALLS"',
      '[ "$#" -eq 1 ] && [ "$1" = knip ] || exit 99',
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
    KNIP_TEST_CALLS: callsPath,
    KNIP_STUB_OUTPUT: knipOutput,
    KNIP_STUB_STATUS: String(knipStatus),
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
      assert.deepEqual(result.calls, ["npx"]);
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
      assert.deepEqual(result.calls, ["npx"]);
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

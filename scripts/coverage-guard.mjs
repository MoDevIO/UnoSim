import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const coverageDir = path.join(rootDir, "coverage");
const lcovPath = path.join(coverageDir, "lcov.info");
const runStartPath = path.join(rootDir, ".coverage-run-start.json");
const requiredSources = [
  "client/src/components/simulator/ExperimentalWorkspace.tsx",
  "server/routes/tutor.routes.ts",
];

function fail(message) {
  console.error(`Coverage validation failed: ${message}`);
  process.exitCode = 1;
}

function normalizeSource(source) {
  return source.trim().replaceAll("\\", "/");
}

async function prepare() {
  await rm(coverageDir, { recursive: true, force: true });
  await writeFile(
    runStartPath,
    JSON.stringify({ startedAt: Date.now() }),
    "utf8",
  );
  console.log("Coverage directory cleaned before test run.");
}

async function validate() {
  let runStart;
  try {
    runStart = JSON.parse(await readFile(runStartPath, "utf8"));
  } catch {
    fail("coverage run marker is missing; run the guarded coverage command first");
    return;
  }

  let lcovStats;
  let lcov;
  try {
    [lcovStats, lcov] = await Promise.all([
      stat(lcovPath),
      readFile(lcovPath, "utf8"),
    ]);
  } catch {
    fail(`${path.relative(rootDir, lcovPath)} is missing`);
    return;
  }

  if (!lcovStats.isFile() || lcovStats.size === 0) {
    fail(`${path.relative(rootDir, lcovPath)} is empty`);
    return;
  }

  if (typeof runStart.startedAt !== "number" || lcovStats.mtimeMs < runStart.startedAt) {
    fail(`${path.relative(rootDir, lcovPath)} is stale`);
    return;
  }

  const records = lcov.split(/(?:^|\r?\n)end_of_record(?:\r?\n|$)/m);
  const completeRecords = records.filter((record) => record.trim().length > 0);
  const hasIncompleteRecord = completeRecords.some(
    (record) =>
      !/^SF:.+$/m.test(record) ||
      !/^LF:\d+$/m.test(record) ||
      !/^LH:\d+$/m.test(record),
  );
  if (completeRecords.length === 0 || hasIncompleteRecord || !/end_of_record(?:\r?\n|$)/.test(lcov)) {
    fail(`${path.relative(rootDir, lcovPath)} is incomplete`);
    return;
  }

  const sources = new Set(
    [...lcov.matchAll(/^SF:(.+)$/gm)].map((match) => normalizeSource(match[1])),
  );
  const missingSources = requiredSources.filter(
    (required) =>
      !sources.has(required) &&
      ![...sources].some((source) => source.endsWith(`/${required}`)),
  );
  if (missingSources.length > 0) {
    fail(`representative source entries are missing: ${missingSources.join(", ")}`);
    return;
  }

  await rm(runStartPath, { force: true });
  console.log(
    `Fresh coverage validated: ${path.relative(rootDir, lcovPath)} (${sources.size} source files).`,
  );
}

const command = process.argv[2];
if (command === "prepare") {
  await prepare();
} else if (command === "validate") {
  await validate();
} else {
  fail("use either 'prepare' or 'validate'");
}

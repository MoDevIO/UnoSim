import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const coverageDir = path.join(rootDir, "coverage");
// The emulation core runs in its own coverage pass (V8 block coverage slows
// the avr8js interpreter down too much for the shared unit budget).
const lcovPaths = [path.join(coverageDir, "lcov.info"), path.join(coverageDir, "emulator", "lcov.info")];
const runStartPath = path.join(rootDir, ".coverage-run-start.json");
const requiredSources = [
  "client/src/components/simulator/ExperimentalWorkspace.tsx",
  "server/routes/tutor.routes.ts",
  "packages/avr-emulator/src/mcu/memory.ts",
];
// Minimum line coverage per package source tree (plan 7.9: at least 90 % in the core).
const packageThresholds = [{ prefix: "packages/avr-emulator/src/", minimum: 0.9 }];

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

/** Aggregated line coverage of all lcov records below `prefix`; false when below `minimum`. */
function checkPackageThreshold(records, { prefix, minimum }) {
  let found = 0;
  let hit = 0;
  for (const record of records) {
    const source = normalizeSource(/^SF:(.+)$/m.exec(record)?.[1] ?? "");
    if (!source.includes(prefix)) continue;
    found += Number(/^LF:(\d+)$/m.exec(record)?.[1] ?? 0);
    hit += Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0);
  }
  const percent = found === 0 ? 0 : (hit / found) * 100;
  if (percent < minimum * 100) {
    fail(`line coverage of ${prefix} is ${percent.toFixed(1)} %, below ${minimum * 100} %`);
    return false;
  }
  console.log(`Line coverage of ${prefix}: ${percent.toFixed(1)} % (minimum ${minimum * 100} %).`);
  return true;
}

/** Reads one fresh, complete lcov file; returns its records or undefined after reporting why not. */
async function readLcov(lcovPath, startedAt) {
  const name = path.relative(rootDir, lcovPath);
  let lcovStats;
  let lcov;
  try {
    [lcovStats, lcov] = await Promise.all([stat(lcovPath), readFile(lcovPath, "utf8")]);
  } catch {
    fail(`${name} is missing`);
    return undefined;
  }
  if (!lcovStats.isFile() || lcovStats.size === 0) {
    fail(`${name} is empty`);
    return undefined;
  }
  if (typeof startedAt !== "number" || lcovStats.mtimeMs < startedAt) {
    fail(`${name} is stale`);
    return undefined;
  }
  const records = lcov.split(/(?:^|\r?\n)end_of_record(?:\r?\n|$)/m).filter((record) => record.trim().length > 0);
  const hasIncompleteRecord = records.some(
    (record) => !/^SF:.+$/m.test(record) || !/^LF:\d+$/m.test(record) || !/^LH:\d+$/m.test(record),
  );
  if (records.length === 0 || hasIncompleteRecord || !/end_of_record(?:\r?\n|$)/.test(lcov)) {
    fail(`${name} is incomplete`);
    return undefined;
  }
  return records;
}

async function validate() {
  let runStart;
  try {
    runStart = JSON.parse(await readFile(runStartPath, "utf8"));
  } catch {
    fail("coverage run marker is missing; run the guarded coverage command first");
    return;
  }

  const completeRecords = [];
  for (const lcovPath of lcovPaths) {
    const records = await readLcov(lcovPath, runStart.startedAt);
    if (!records) return;
    completeRecords.push(...records);
  }

  const sources = new Set(
    completeRecords.map((record) => normalizeSource(/^SF:(.+)$/m.exec(record)?.[1] ?? "")),
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

  for (const threshold of packageThresholds) {
    if (!checkPackageThreshold(completeRecords, threshold)) return;
  }

  await rm(runStartPath, { force: true });
  console.log(
    `Fresh coverage validated: ${lcovPaths.map((p) => path.relative(rootDir, p)).join(", ")} (${sources.size} source files).`,
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

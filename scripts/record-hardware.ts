// Records a corpus case on a real board (plan 7.4, class `hardware`):
//   npm run record:hardware -- tests/fixtures/runtime-corpus/probes/data_types --port /dev/cu.usbmodem1101
//   ... --accept "Arduino Uno R3 (genuine)"     # turn a matching recording into the expectation
// Uploads the sketch, resets the board, replays the stimuli (serial text automatically, pins and voltages
// are announced for the person to set) and writes recorded.<board>.txt next to the case.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { CORPUS_FQBN } from "./runtime-fixtures";
import { acceptedCase, baudOf, lineDiff, normalizeRecording, stepsOf } from "./record-hardware-lib";

const TOOLCHAIN = "arduino-cli 1.5.1, arduino:avr@1.8.8";
const args = process.argv.slice(2);
const option = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const caseDir = resolve(args.find((arg) => !arg.startsWith("--")) ?? "");
const port = option("--port");
const bootMs = Number(option("--boot-ms") ?? 2500);
const accept = option("--accept");

if (!existsSync(join(caseDir, "case.json")) || !port) {
  console.error('usage: npm run record:hardware -- <case dir> --port <serial port> [--boot-ms 2500] [--accept "<board and revision>"] [--no-upload]');
  process.exit(2);
}
const caseFile = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as { board: string; simMs: number; events?: never[]; expectState?: unknown[] } & Record<string, unknown>;
const id = basename(caseDir);
const fqbn = CORPUS_FQBN[caseFile.board];
const sketch = readFileSync(join(caseDir, `${id}.ino`), "utf8");
const baud = baudOf(sketch);

if (!args.includes("--no-upload")) {
  const work = mkdtempSync(join(tmpdir(), "unosim-record-"));
  try {
    cpSync(caseDir, join(work, id), { recursive: true, filter: (source) => !/(case\.json|expected\..*\.txt|recorded\..*\.txt)$/.test(source) });
    console.log(`uploading ${id} to ${port} …`);
    // Maintainer tool: uses the arduino-cli the maintainer installed on the PATH.
    const upload = spawnSync("arduino-cli", ["compile", "--upload", "--fqbn", fqbn, "--port", port, join(work, id)], { stdio: "inherit" }); // NOSONAR S4036
    if (upload.status !== 0) process.exit(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const steps = stepsOf((caseFile.events ?? []) as never);
const recordMs = bootMs + caseFile.simMs + 500;
console.log(`recording ${recordMs} ms at ${baud ?? "no"} baud (boot allowance ${bootMs} ms). Get ready:`);
for (const step of steps) if (step.instruction) console.log(`  at +${step.atMs} ms after the sketch starts: ${step.instruction}`);
console.log("starting in 3 s …");
await new Promise((resolveStart) => setTimeout(resolveStart, 3000));

const monitorArgs = ["monitor", "--quiet", "--raw", "--port", port, "--config", `baudrate=${baud ?? 9600}`];
const monitor = spawn("arduino-cli", monitorArgs, { stdio: ["pipe", "pipe", "inherit"] }); // NOSONAR S4036
let recorded = "";
monitor.stdout.on("data", (chunk: Buffer) => { recorded += chunk.toString("latin1"); });
const started = Date.now();
for (const step of steps) {
  setTimeout(() => {
    if (step.send !== undefined) monitor.stdin.write(step.send);
    if (step.instruction) console.log(`\x07NOW (+${step.atMs} ms): ${step.instruction}`);
  }, bootMs + step.atMs);
}
await new Promise((resolveDone) => setTimeout(resolveDone, recordMs));
monitor.kill();
console.log(`recorded ${recorded.length} bytes in ${Date.now() - started} ms`);

const text = normalizeRecording(Buffer.from(recorded, "latin1").toString("utf8"));
const target = join(caseDir, `recorded.${caseFile.board}.txt`);
writeFileSync(target, text);
const expectedPath = join(caseDir, `expected.${caseFile.board}.txt`);
const differences = lineDiff(readFileSync(expectedPath, "utf8"), text);
if (differences.length === 0) console.log("the recording equals the current expectation");
else console.log(`differences to the current expectation:\n  ${differences.slice(0, 20).join("\n  ")}`);

if (accept && (caseFile.expectState?.length ?? 0) > 0) {
  console.log("not accepted: this case also checks pin, PWM or ADC states (expectState), which a serial recording does not cover; the case stays as it is");
} else if (accept) {
  writeFileSync(expectedPath, text);
  writeFileSync(join(caseDir, "case.json"), `${JSON.stringify(acceptedCase(caseFile, accept, TOOLCHAIN), null, 2)}\n`);
  console.log(`accepted: expected.${caseFile.board}.txt replaced, case.json set to class hardware (${accept})`);
}

// Records a corpus case on a real board (plan 7.4, class `hardware`):
//   npm run record:hardware -- tests/fixtures/runtime-corpus/probes/data_types --port /dev/cu.usbmodem1101
//   ... --accept "Arduino Uno R3 (genuine)"     # turn a matching recording into the expectation
//   ... --programmer usbasp --upload-port usb    # ATtiny85: upload through an ISP programmer, record on --port
// Uploads the sketch, resets the board, replays the stimuli (serial text automatically, pins and voltages
// are announced for the person to set) and writes recorded.<board>.txt next to the case.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { CORPUS_FQBN } from "./runtime-fixtures";
import { diffOutput, type Tolerance } from "../packages/avr-emulator/tests/corpus-helpers";
import { acceptedCase, baudOf, lineDiff, normalizeRecording, recordingToolchain, stepsOf, stripLeadingNoise } from "./record-hardware-lib";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const caseDir = resolve(args.find((arg) => !arg.startsWith("--")) ?? "");
const port = option("--port");
const bootMs = Number(option("--boot-ms") ?? 3300);
const accept = option("--accept");
// Boards without a USB bootloader (ATtiny85) are programmed through an ISP programmer at another port than the
// serial adapter the recording reads.
const programmer = option("--programmer");

if (!existsSync(join(caseDir, "case.json")) || !port) {
  console.error('usage: npm run record:hardware -- <case dir> --port <serial port> [--boot-ms 3300] [--accept "<board and revision>"] [--attempts N] [--no-upload] [--programmer <id> --upload-port <port>]');
  process.exit(2);
}
const uploadPort = option("--upload-port") ?? port;
const caseFile = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as { board: string; simMs: number; events?: never[]; expectState?: unknown[]; tolerances?: Tolerance[] } & Record<string, unknown>;
const id = basename(caseDir);
const fqbn = CORPUS_FQBN[caseFile.board];
const sketch = readFileSync(join(caseDir, `${id}.ino`), "utf8");
const baud = baudOf(sketch);

// Every attempt starts from a fresh upload: closing the port does not reset the board, so a free-running sketch
// would otherwise hand the next recording the middle of its previous run.
function uploadSketch(): void {
  if (args.includes("--no-upload")) return;
  const work = mkdtempSync(join(tmpdir(), "unosim-record-"));
  try {
    cpSync(caseDir, join(work, id), { recursive: true, filter: (source) => !/(case\.json|expected\..*\.txt|recorded\..*\.txt)$/.test(source) });
    console.log(`uploading ${id} to ${uploadPort} …`);
    // Maintainer tool: uses the arduino-cli the maintainer installed on the PATH.
    const programmerArgs = programmer ? ["--programmer", programmer] : [];
    const upload = spawnSync("arduino-cli", ["compile", "--upload", "--fqbn", fqbn, "--port", uploadPort, ...programmerArgs, join(work, id)], { stdio: "inherit" }); // NOSONAR S4036
    if (upload.status !== 0) process.exit(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const steps = stepsOf((caseFile.events ?? []) as never);
const recordMs = bootMs + caseFile.simMs + 500;
console.log(`recording ${recordMs} ms at ${baud ?? "no"} baud (boot allowance ${bootMs} ms). Get ready:`);
for (const step of steps) if (step.instruction) console.log(`  at +${step.atMs} ms after the sketch starts: ${step.instruction}`);
const monitorArgs = ["monitor", "--quiet", "--raw", "--port", port, "--config", `baudrate=${baud ?? 9600},dtr=on,rts=on`];

// Opening the port resets the board through the USB bridge; a run is recorded from that reset on.
async function recordOnce(): Promise<string> {
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
  const expectedFirst = expectedText.split("\n", 1)[0] ?? "";
  const { text: clean, stripped } = stripLeadingNoise(recorded, (line) => diffOutput(expectedFirst, line, caseFile.tolerances ?? []).length === 0);
  if (stripped) console.log(`  bridge noise ahead of the first line, stripped: ${Buffer.from(stripped, "latin1").toString("hex")}`);
  return normalizeRecording(Buffer.from(clean, "latin1").toString("utf8"));
}

const expectedPath = join(caseDir, `expected.${caseFile.board}.txt`);
const expectedText = readFileSync(expectedPath, "utf8");
// A few bytes of line noise from the bridge sometimes precede the sketch output, so a run that differs is repeated
// (without upload) while no person is needed; a real deviation shows up in every attempt, and every attempt is reported.
const attempts = Number(option("--attempts") ?? (steps.some((step) => step.instruction) ? 1 : 3));
let text = "";
let differences: string[] = [];
for (let attempt = 1; attempt <= attempts; attempt++) {
  uploadSketch();
  console.log("starting in 3 s …");
  await new Promise((resolveStart) => setTimeout(resolveStart, 3000));
  text = await recordOnce();
  // The recording runs longer than the simulated window: lines after the expectation are reported, not compared.
  const wantLines = expectedText.split("\n").length - 1;
  const gotLines = text.split("\n");
  const window = gotLines.length - 1 > wantLines ? `${gotLines.slice(0, wantLines).join("\n")}\n` : text;
  if (window !== text) console.log(`  ${gotLines.length - 1 - wantLines} further line(s) after the simulated window of ${caseFile.simMs} ms are not compared`);
  differences = diffOutput(expectedText, window, caseFile.tolerances ?? []);
  const exact = lineDiff(expectedText, window).length === 0;
  text = window;
  let verdict = `${differences.length} differing line(s)`;
  if (differences.length === 0) verdict = exact ? "equals the current expectation" : "equals the expectation within the case tolerances";
  console.log(`attempt ${attempt}/${attempts}: ${verdict}`);
  if (differences.length === 0) break;
  console.log(`  ${differences.slice(0, 20).join("\n  ")}`);
}
writeFileSync(join(caseDir, `recorded.${caseFile.board}.txt`), text);

// Only a recording that equals the expectation is taken over; a deviation is classified by a person first.
if (accept && differences.length > 0) {
  console.log("not accepted: the recording differs from the current expectation; classify the deviation first");
} else if (accept && (caseFile.expectState?.length ?? 0) > 0) {
  console.log("not accepted: this case also checks pin, PWM or ADC states (expectState), which a serial recording does not cover; the case stays as it is");
} else if (accept) {
  writeFileSync(expectedPath, text); // the measured values; the tolerances of the case stay as they are
  writeFileSync(join(caseDir, "case.json"), `${JSON.stringify(acceptedCase(caseFile, accept, recordingToolchain(caseFile.board)), null, 2)}\n`);
  console.log(`accepted: expected.${caseFile.board}.txt holds the recording, case.json set to class hardware (${accept})`);
}

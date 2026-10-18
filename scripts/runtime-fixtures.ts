// Builds the HEX fixtures of the runtime reference corpus (plan 7.4, P1.14):
//   npm run fixtures:runtime            rebuild tests/fixtures/runtime-corpus/hex/<board>/<case>.hex
//   npm run fixtures:runtime -- --check compare a rebuild with the checked-in files
// The toolchain (arduino-cli, arduino:avr core) is the pinned one of the CI toolchain gate.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CORPUS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/runtime-corpus");

/** Boards of the corpus and their FQBN (plan 4.3: Nano with the ATmega328P option). */
export const CORPUS_FQBN: Readonly<Record<string, string>> = {
  uno: "arduino:avr:uno",
  nano: "arduino:avr:nano:cpu=atmega328",
};

export interface CorpusCaseRef {
  /** Directory of the case: `probes/<id>` or `examples-v3.0.0/<id>`. */
  readonly dir: string;
  readonly id: string;
  readonly board: string;
}

/** All case directories (those with a `case.json`), sorted. */
export function listCaseDirs(root = CORPUS_ROOT): string[] {
  const found: string[] = [];
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory() || group.name === "hex") continue;
    for (const entry of readdirSync(join(root, group.name), { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(root, group.name, entry.name, "case.json"))) found.push(join(root, group.name, entry.name));
    }
  }
  return found.sort();
}

export function readCaseRef(dir: string): CorpusCaseRef {
  const { board } = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { board?: string };
  if (!board || !CORPUS_FQBN[board]) throw new Error(`${dir}/case.json: unknown board "${board}"`);
  return { dir, id: basename(dir), board };
}

export function hexPath(ref: CorpusCaseRef, root = CORPUS_ROOT): string {
  return join(root, "hex", ref.board, `${ref.id}.hex`);
}

/** Compiles the sketch of a case in a scratch copy (so build artifacts never land in the repository) and returns its HEX. */
export function compileCase(ref: CorpusCaseRef): string {
  const work = mkdtempSync(join(tmpdir(), "unosim-corpus-"));
  try {
    const sketch = join(work, ref.id);
    cpSync(ref.dir, sketch, { recursive: true, filter: (source) => !/(case\.json|expected\..*\.txt)$/.test(source) });
    const out = join(work, "out");
    const result = spawnSync("arduino-cli", ["compile", "--fqbn", CORPUS_FQBN[ref.board], "--output-dir", out, sketch], {
      encoding: "utf8",
      timeout: 300_000,
    });
    if (result.status !== 0) throw new Error(`arduino-cli failed for ${ref.id}:\n${result.stderr || result.stdout}`);
    return readFileSync(join(out, `${ref.id}.ino.hex`), "utf8");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(args: readonly string[]): number {
  const check = args.includes("--check");
  const only = args.find((arg) => !arg.startsWith("--"));
  let mismatches = 0;
  for (const dir of listCaseDirs()) {
    const ref = readCaseRef(dir);
    if (only && ref.id !== only) continue;
    const hex = compileCase(ref);
    const target = hexPath(ref);
    if (check) {
      const same = existsSync(target) && readFileSync(target, "utf8") === hex;
      if (!same) mismatches++;
      process.stdout.write(`${same ? "ok      " : "DIFFERS "}${ref.board}/${ref.id}\n`);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, hex);
      process.stdout.write(`written ${ref.board}/${ref.id}\n`);
    }
  }
  return mismatches === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));

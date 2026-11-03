// Builds the HEX fixtures of the runtime reference corpus (plan 7.4, P1.14):
//   npm run fixtures:runtime            rebuild tests/fixtures/runtime-corpus/hex/<board>/<case>.hex
//   npm run fixtures:runtime -- --check compare a rebuild with the checked-in files
// The toolchain (arduino-cli, arduino:avr core, ATTinyCore) is the pinned one of the CI toolchain gate.
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CORPUS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/runtime-corpus");

/** Boards of the corpus and their FQBN (plan 4.3: Nano with the ATmega328P option, Mega with the ATmega2560 option). */
export const CORPUS_FQBN: Readonly<Record<string, string>> = {
  uno: "arduino:avr:uno",
  nano: "arduino:avr:nano:cpu=atmega328",
  mega2560: "arduino:avr:mega:cpu=atmega2560",
  attiny85: "ATTinyCore:avr:attinyx5:chip=85,clock=8internal",
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
  return found.sort((a, b) => a.localeCompare(b));
}

export function readCaseRef(dir: string): CorpusCaseRef {
  const { board } = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { board?: string };
  if (!board || !CORPUS_FQBN[board]) throw new Error(`${dir}/case.json: unknown board "${board}"`);
  return { dir, id: basename(dir), board };
}

export function hexPath(ref: CorpusCaseRef, root = CORPUS_ROOT): string {
  return join(root, "hex", ref.board, `${ref.id}.hex`);
}

/** Time limit of one `arduino-cli compile`; the process is killed when it passes. */
const COMPILE_TIMEOUT_MS = 300_000;

/** Runs `arduino-cli`; a failure names the case, the reason (exit code, timeout, missing tool) and the compiler output. */
function runArduinoCli(id: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // The maintainer tool and the CI toolchain job use the arduino-cli they installed on the PATH.
    execFile("arduino-cli", args, { encoding: "utf8", env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => { // NOSONAR S4036
      if (!error) {
        resolvePromise();
        return;
      }
      let reason = `exit code ${error.code}`;
      if (error.killed) reason = `timed out after ${timeoutMs} ms`;
      else if (typeof error.code === "string") reason = error.message;
      const output = stderr || stdout;
      const message = `arduino-cli failed for ${id} (${reason})`;
      reject(new Error(output ? `${message}:\n${output}` : message));
    });
  });
}

/**
 * The build cache of one corpus run: compiles share reusable core artifacts without writing to the user's
 * global arduino-cli cache. Concurrent cold compiles may initially build the same core. `dispose()` waits for all compiles still
 * running (a timed-out test does not stop its process) and then removes the cache, also after failures.
 */
export class CorpusBuildCache {
  readonly path = mkdtempSync(join(tmpdir(), "unosim-corpus-cache-"));
  private readonly running = new Set<Promise<string>>();

  /** Compiles the sketch of a case in a scratch copy (so build artifacts never land in the repository) and returns its HEX. */
  compile(ref: CorpusCaseRef, timeoutMs = COMPILE_TIMEOUT_MS): Promise<string> {
    const compile = this.compileCase(ref, timeoutMs);
    this.running.add(compile);
    void compile.catch(() => undefined).finally(() => this.running.delete(compile));
    return compile;
  }

  async dispose(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running);
    await rm(this.path, { recursive: true, force: true });
  }

  private async compileCase(ref: CorpusCaseRef, timeoutMs: number): Promise<string> {
    const work = await mkdtemp(join(tmpdir(), "unosim-corpus-"));
    try {
      const sketch = join(work, ref.id);
      await cp(ref.dir, sketch, { recursive: true, filter: (source) => !/(case\.json|expected\..*\.txt)$/.test(source) });
      const out = join(work, "out");
      const env = { ...process.env, ARDUINO_BUILD_CACHE_PATH: this.path };
      await runArduinoCli(ref.id, ["compile", "--fqbn", CORPUS_FQBN[ref.board], "--output-dir", out, sketch], env, timeoutMs);
      return await readFile(join(out, `${ref.id}.ino.hex`), "utf8");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

async function main(args: readonly string[]): Promise<number> {
  const check = args.includes("--check");
  const only = args.find((arg) => !arg.startsWith("--"));
  let mismatches = 0;
  const cache = new CorpusBuildCache();
  try {
    for (const dir of listCaseDirs()) {
      const ref = readCaseRef(dir);
      if (only && ref.id !== only) continue;
      const hex = await cache.compile(ref);
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
  } finally {
    await cache.dispose();
  }
  return mismatches === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

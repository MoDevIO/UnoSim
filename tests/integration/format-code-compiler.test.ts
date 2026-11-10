import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatCode } from "../../client/src/lib/editor/format-code";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";
import { getBoard } from "../../shared/boards";

/**
 * "Format Code" keeps the meaning of a sketch (ssot/ssot_function_definition_CodeFormatting.md 3.4), checked by
 * the compiler instead of the formatter's own lexer: the AVR compiler's assembly of each fixture is the same before
 * and after formatting, and each built-in example compiles to the same HEX. Size assertions in the fixtures turn a
 * moved byte inside a literal into a compile error.
 */

const FIXTURES = resolve(__dirname, "../fixtures/format-code");
const EXAMPLES = resolve(__dirname, "../../public/examples");

/** The avr-g++ of the installed Arduino AVR core (Linux, macOS, or `ARDUINO_DIRECTORIES_DATA`). */
function avrGxx(): string {
  const roots = [process.env.ARDUINO_DIRECTORIES_DATA, join(homedir(), ".arduino15"), join(homedir(), "Library", "Arduino15")];
  for (const root of roots) {
    const tools = root ? join(root, "packages", "arduino", "tools", "avr-gcc") : "";
    if (!tools || !existsSync(tools)) continue;
    for (const version of readdirSync(tools).sort().reverse()) {
      const compiler = join(tools, version, "bin", "avr-g++");
      if (existsSync(compiler)) return compiler;
    }
  }
  throw new Error("avr-g++ of the Arduino AVR core not found");
}

function assembly(compiler: string, source: string): string {
  const result = spawnSync(compiler, ["-std=gnu++11", "-mmcu=atmega328p", "-Os", "-S", "-o", "-", "-x", "c++", "-"], {
    input: source,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || `avr-g++ exited with ${result.status}`);
  return result.stdout;
}

describe("Format Code keeps the meaning, checked by the AVR compiler (real toolchain)", () => {
  const fixtures = readdirSync(FIXTURES).filter((file) => file.endsWith(".cpp")).sort();

  it("has the fixtures, among them the four counterexamples of the review of 322eba6da", () => {
    expect(fixtures).toEqual(expect.arrayContaining([
      "braceless-control.cpp", "macro-leading-comment.cpp", "protected-text.cpp",
      "raw-quoted-delimiter-nested.cpp", "split-comment.cpp", "string-splice.cpp",
      // review of 01243d588: block-comment delimiters split by a splice, keywords and braces split by a splice
      "split-block-comment.cpp", "spliced-structure.cpp",
      // review of 6a25d4706: a no-break space at the end of a macro is replacement text, not a blank
      "macro-trailing-nbsp.cpp",
    ]));
  });

  it.each(fixtures)("%s: formatting changes the layout, not the assembly", (file) => {
    const compiler = avrGxx();
    const source = readFileSync(join(FIXTURES, file), "utf8");
    const formatted = formatCode(source);

    expect(formatted).not.toBe(source);
    expect(assembly(compiler, formatted)).toBe(assembly(compiler, source));
  });
});

describe.concurrent("Format Code on the built-in examples: the same HEX (real toolchain)", () => {
  let compiler: ArduinoCompiler;
  let root: string;
  const examples = readdirSync(EXAMPLES).filter((file) => file.endsWith(".ino")).sort();

  beforeAll(async () => {
    compiler = new ArduinoCompiler();
    root = await mkdtemp(join(tmpdir(), "unosim-format-code-it-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function hex(code: string, build: string): Promise<string> {
    const result = await compiler.compile(code, undefined, undefined, {
      board: "uno",
      fqbn: getBoard("uno").fqbn,
      buildPath: join(root, build),
      hexCacheDir: join(root, `hex-cache-${build}`),
    });
    expect(result.errors).toEqual([]);
    return result.binary!.toString("utf8");
  }

  it.each(examples)("%s", async (file) => {
    const source = readFileSync(join(EXAMPLES, file), "utf8");
    const [before, after] = await Promise.all([hex(source, `${file}-before`), hex(formatCode(source), `${file}-after`)]);
    expect(after).toBe(before);
  });
});

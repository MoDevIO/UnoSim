import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getFastTmpBaseDir } from "../../shared/utils/temp-paths";
import { DockerCommandBuilder } from "../../server/services/docker-command-builder";
import {
  COMPILE_CONTAINER_PREFIX,
  type CompileSandboxSettings,
  compileInSandbox,
  runCliJsonInSandbox,
} from "../../server/services/compiler/sandboxed-cli-runner";
import { parseCliVersion, parseCores } from "../../server/services/compiler/toolchain-info";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";
import { ProcessExecutor } from "../../server/services/process-executor";
import { simulationArtifactSchema } from "../../shared/simulation-artifact";

/**
 * Contract of the compile sandbox (plan P2.4, 7.8) against the real image
 * `unosim-compile-sandbox`: isolation, no foreign files, explicit environment,
 * time limit, cleanup. The attacks are those of spike P0.2.
 */
const enabled = process.env.NODE_ENV === "test" && process.env.UNOSIM_SERVER_MODE === "docker";
const maybeDescribe = enabled ? describe : describe.skip;

const OWNER = `compile-contract.${process.pid}`;
const SETTINGS: CompileSandboxSettings = {
  image: process.env.COMPILE_SANDBOX_IMAGE ?? "unosim-compile-sandbox:latest",
  memoryMB: 512,
  cpuLimit: "1",
  pidsLimit: 128,
  tmpfsMB: 256,
  timeoutMs: 60_000,
  owner: OWNER,
};
const BACKEND_MARKER = "BACKEND_APP_MARKER_91c2";
const FOREIGN_SECRET = "FOREIGN_SKETCH_SECRET_7f3a";

let work: string;
let backendFile: string;
let foreignSketch: string;

function sketch(name: string, source: string): string {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.ino`);
  writeFileSync(file, source);
  return file;
}

/** A sketch that puts the content of `path` into flash (`.incbin`) or into assembler diagnostics (`.include`). */
function disclosureProbe(name: string, directive: "incbin" | "include", path: string): string {
  const asm = directive === "incbin"
    ? `__asm__(".section .progmem.data\\n.global leak\\nleak: .incbin \\"${path}\\"\\n.byte 0\\n.text");\nextern const char leak[] __attribute__((progmem));`
    : `__asm__(".include \\"${path}\\"");\nextern const char leak[];`;
  return sketch(name, `${asm}\nvoid setup(){ Serial.begin(9600); Serial.println((const __FlashStringHelper*)leak); }\nvoid loop(){}\n`);
}

function flashText(hex: Buffer | undefined): string {
  if (!hex) return "";
  const bytes: Buffer[] = [];
  for (const line of hex.toString("utf8").split(/\r?\n/)) {
    if (!line.startsWith(":")) continue;
    const record = Buffer.from(line.slice(1), "hex");
    if (record[3] === 0) bytes.push(record.subarray(4, 4 + record[0]));
  }
  return Buffer.concat(bytes).toString("latin1");
}

/** A probe command in a container with exactly the flags of a compile container. */
function probe(command: string[], sketchFile?: string): { code: number | null; stdout: string; stderr: string } {
  const args = DockerCommandBuilder.buildCompileSandboxCommand({
    ...SETTINGS,
    imageName: SETTINGS.image,
    containerName: `${COMPILE_CONTAINER_PREFIX}probe-${process.pid}-${Date.now()}`,
    labels: [`unosim.owner=${OWNER}`],
    ...(sketchFile ? { sketch: { dir: join(sketchFile, ".."), target: "/sketch/probe" } } : {}),
    command,
  });
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ownedContainers(): string[] {
  const result = spawnSync("docker", ["ps", "-aq", "--filter", `label=unosim.owner=${OWNER}`], { encoding: "utf8" });
  return result.stdout.split(/\s+/).filter(Boolean);
}

maybeDescribe("Compile sandbox contract", () => {
  beforeAll(() => {
    const image = spawnSync("docker", ["image", "inspect", SETTINGS.image], { encoding: "utf8" });
    if (image.status !== 0) throw new Error(`Image ${SETTINGS.image} is missing: run npm run build:compile-sandbox`);
    work = mkdtempSync(join(getFastTmpBaseDir(), "unosim-compile-contract-"));
    // A backend file and another student's project, both on the host next to the sketch.
    backendFile = join(work, "backend", "package.json");
    mkdirSync(join(work, "backend"), { recursive: true });
    writeFileSync(backendFile, `{"name":"${BACKEND_MARKER}"}\n`);
    foreignSketch = sketch("victim", `// ${FOREIGN_SECRET}\nvoid setup(){}\nvoid loop(){}\n`);
  });

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it.each([
    ["uno", "arduino:avr:uno", "Board: Arduino UNO"],
    ["mega", "arduino:avr:mega:cpu=atmega2560", "Board: Arduino Mega 2560"],
  ])("compiles a sketch for the %s to HEX and ELF", async (name, fqbn, board) => {
    const file = sketch(`blink_${name}`, "void setup(){ pinMode(13, OUTPUT); }\nvoid loop(){ digitalWrite(13, !digitalRead(13)); delay(100); }\n");
    const result = await compileInSandbox(file, { fqbn }, undefined, SETTINGS);
    expect(result.success, result.errors).toBe(true);
    expect(result.binary?.toString("utf8")).toMatch(/^:[0-9A-F]{10}/);
    expect(result.elf?.subarray(0, 4).toString("latin1")).toBe("\x7fELF");
    expect(result.output).toContain("Sketch uses");
    expect(result.output).toContain(board);
  });

  it("reports compiler errors against sketch.ino without host or container paths", async () => {
    const file = sketch("broken", "void setup(){ foo(); }\nvoid loop(){}\n");
    const result = await compileInSandbox(file, { fqbn: "arduino:avr:uno" }, undefined, SETTINGS);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("sketch.ino:1:15: error: 'foo' was not declared");
    expect(result.errors).not.toContain(work);
    expect(result.errors).not.toContain("/sketch/");
  });

  it.each(["incbin", "include"] as const)("cannot read a backend file or another project (.%s)", async (directive) => {
    for (const [target, marker] of [[backendFile, BACKEND_MARKER], [foreignSketch, FOREIGN_SECRET]] as const) {
      const result = await compileInSandbox(disclosureProbe(`leak_${directive}_${marker.length}${target.length}`, directive, target), { fqbn: "arduino:avr:uno" }, undefined, SETTINGS);
      expect(result.success).toBe(false);
      expect(`${result.output}\n${result.errors}`).not.toContain(marker);
      expect(flashText(result.binary)).not.toContain(marker);
      expect(result.errors).toMatch(/No such file|file not found|can't open/i);
    }
  });

  it("gives the toolchain only its explicit environment, also through .include of /proc/self/environ", async () => {
    process.env.UNOSIM_COMPILE_CONTRACT_SENTINEL = "sentinel-value-3b7d";
    try {
      // `env` as the container's first process shows what every process in it inherits.
      const environment = probe(["env"]);
      expect(environment.code).toBe(0);
      expect(environment.stdout.split("\n").filter(Boolean).map((line) => line.split("=")[0]).sort()).toEqual(["HOME", "HOSTNAME", "PATH"]);
      const result = await compileInSandbox(disclosureProbe("leak_environ", "include", "/proc/self/environ"), { fqbn: "arduino:avr:uno" }, undefined, SETTINGS);
      expect(result.success).toBe(false);
      expect(result.errors).not.toContain("sentinel");
    } finally {
      delete process.env.UNOSIM_COMPILE_CONTRACT_SENTINEL;
    }
  });

  it("has no network, an immutable root, a read-only sketch and a tmpfs without exec", () => {
    const file = sketch("isolation", "void setup(){}\nvoid loop(){}\n");
    const result = probe(["sh", "-c", [
      // Without a network there is no route; the kernel's own tunnel devices stay down.
      "echo routes=$(tail -n +2 /proc/net/route | wc -l)",
      "touch /probe 2>/dev/null && echo root=writable || echo root=read-only",
      "touch /sketch/probe/new 2>/dev/null && echo sketch=writable || echo sketch=read-only",
      "cp /bin/true /tmp/true && (/tmp/true 2>/dev/null && echo tmp=exec || echo tmp=noexec)",
      "echo uid=$(id -u)",
      "test -e /var/run/docker.sock && echo socket=yes || echo socket=no",
    ].join("; ")], file);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("routes=0\n");
    expect(result.stdout).toContain("root=read-only");
    expect(result.stdout).toContain("sketch=read-only");
    expect(result.stdout).toContain("tmp=noexec");
    expect(result.stdout).toContain("uid=1000");
    expect(result.stdout).toContain("socket=no");
  });

  it("stops a compile at the time limit and leaves no container behind", async () => {
    // About 10^5 statements by macro expansion (spike P0.2: 4.8 s at one CPU).
    const bomb = [
      "#define A volatile int x = 1; x++;",
      "#define B A A A A A A A A A A",
      "#define C B B B B B B B B B B",
      "#define D C C C C C C C C C C",
      "#define E D D D D D D D D D D",
      "void setup(){ E E E E E E E E E E }",
      "void loop(){}",
    ].join("\n");
    const started = Date.now();
    const result = await compileInSandbox(sketch("bomb", `${bomb}\n`), { fqbn: "arduino:avr:uno" }, undefined, { ...SETTINGS, timeoutMs: 1_000 });
    expect(result).toMatchObject({ success: false, errors: "Compilation timed out after 1 s." });
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("reads the toolchain of the image for the build identity", async () => {
    expect(parseCliVersion(await runCliJsonInSandbox(["version", "--format", "json"], undefined, SETTINGS))).toBe("1.5.1");
    expect(parseCores(await runCliJsonInSandbox(["core", "list", "--format", "json"], undefined, SETTINGS))).toContainEqual({ id: "arduino:avr", version: "1.8.8" });
  });

  it("compiles a REST compile of the Docker profile in the sandbox and delivers its artifact", async () => {
    const execute = vi.spyOn(ProcessExecutor.prototype, "execute");
    try {
      // A unique comment keeps the HEX cache from answering.
      const code = `// ${process.pid}-${Date.now()}\nvoid setup(){ pinMode(13, OUTPUT); }\nvoid loop(){ digitalWrite(13, HIGH); }\n`;
      const result = await new ArduinoCompiler().compile(code, [], undefined, { board: "mega2560", fqbn: "arduino:avr:mega:cpu=atmega2560", hexCacheDir: join(work, "hex-cache") });
      expect(result.success, result.stderr).toBe(true);
      expect(simulationArtifactSchema.parse(result.artifact).board).toBe("mega2560");
      const commands = execute.mock.calls.map(([command, args]) => `${command} ${args.join(" ")}`);
      expect(commands.some((line) => line.startsWith("docker run --rm --name unosim-compile-") && line.includes(" unosim-compile 60 compile "))).toBe(true);
      expect(commands.some((line) => line.startsWith("arduino-cli compile"))).toBe(false);
    } finally {
      execute.mockRestore();
    }
  });

  it("removes every compile container it started", () => {
    expect(ownedContainers()).toEqual([]);
  });
});

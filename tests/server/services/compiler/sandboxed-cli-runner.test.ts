import { describe, expect, it, vi } from "vitest";
import {
  type CompileSandboxSettings,
  compileInSandbox,
  parseCompileFrame,
  runCliJsonInSandbox,
} from "../../../../server/services/compiler/sandboxed-cli-runner";
import { ProcessOutputLimitError, ProcessTimeoutError } from "../../../../server/services/process-executor";

const SETTINGS: CompileSandboxSettings = {
  image: "unosim-compile-sandbox:test",
  memoryMB: 512,
  cpuLimit: "1",
  pidsLimit: 128,
  tmpfsMB: 256,
  timeoutMs: 60_000,
  owner: "test-host:42",
};
const SKETCH = "/tmp/unosim-x/0f1e/0f1e.ino";
const b64 = (text: string | Buffer) => Buffer.from(text).toString("base64");

function frame(options: { exit?: number; truncated?: boolean; stdout?: string; files?: Record<string, string> } = {}): string {
  return [
    "unosim-compile-result 1",
    `exit ${options.exit ?? 0}`,
    `truncated ${options.truncated ? 1 : 0}`,
    `stdout ${b64(options.stdout ?? "")}`,
    ...Object.entries(options.files ?? {}).map(([name, content]) => `file ${name} ${b64(content)}`),
    "end",
    "",
  ].join("\n");
}

function executor(...results: Array<{ code: number; stdout?: string; stderr?: string; error?: Error }>) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  return { execute };
}

const valueAfter = (args: string[], flag: string) => args.filter((_, index) => args[index - 1] === flag);

describe("parseCompileFrame", () => {
  it("reads exit code, stdout and the build files", () => {
    const parsed = parseCompileFrame(frame({ stdout: "Sketch uses 882 bytes", files: { "s.ino.hex": ":00000001FF\n", "s.ino.elf": "ELF" } }));
    expect(parsed).toMatchObject({ exitCode: 0, stdout: "Sketch uses 882 bytes", stdoutTruncated: false });
    expect(parsed?.files.get("s.ino.hex")?.toString()).toBe(":00000001FF\n");
    expect([...(parsed?.files.keys() ?? [])]).toEqual(["s.ino.hex", "s.ino.elf"]);
  });

  it("rejects a frame without its end (container stopped) or with a foreign line", () => {
    expect(parseCompileFrame(frame().replace("end\n", ""))).toBeUndefined();
    expect(parseCompileFrame("")).toBeUndefined();
    expect(parseCompileFrame(frame().replace("end", "file ../x AAAA\nend"))).toBeUndefined();
    expect(parseCompileFrame(`noise\n${frame()}`)).toBeUndefined();
  });
});

describe("compileInSandbox", () => {
  it("runs one isolated container with the sketch as its only, read-only mount", async () => {
    const processExecutor = executor({ code: 0, stdout: frame({ files: { "0f1e.ino.hex": ":00000001FF\n" } }), stderr: "" });
    await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno", buildPath: "/host/build" }, processExecutor, SETTINGS);

    const [command, args, options] = processExecutor.execute.mock.calls[0];
    expect(command).toBe("docker");
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(valueAfter(args, "--name")[0]).toMatch(/^unosim-compile-[0-9a-f-]{36}$/);
    expect(valueAfter(args, "--label")).toEqual(["unosim.owner=test-host:42"]);
    expect(valueAfter(args, "--network")).toEqual(["none"]);
    expect(args).toContain("--read-only");
    expect(valueAfter(args, "--cap-drop")).toEqual(["ALL"]);
    expect(valueAfter(args, "--security-opt")).toEqual(["no-new-privileges"]);
    expect(valueAfter(args, "--memory")).toEqual(["512m"]);
    expect(valueAfter(args, "--memory-swap")).toEqual(["512m"]);
    expect(valueAfter(args, "--cpus")).toEqual(["1"]);
    expect(valueAfter(args, "--pids-limit")).toEqual(["128"]);
    expect(valueAfter(args, "--tmpfs")).toEqual(["/tmp:rw,nosuid,nodev,noexec,mode=1777,size=256m"]);
    expect(valueAfter(args, "-v")).toEqual(["/tmp/unosim-x/0f1e:/sketch/0f1e:ro"]);
    expect(valueAfter(args, "--env")).toEqual(["HOME=/home/compile", "PATH=/usr/local/bin:/usr/bin:/bin"]);
    expect(args).not.toContain("--privileged");
    expect(args.join(" ")).not.toContain("docker.sock");
    // The host build path never reaches the container.
    expect(args.slice(args.indexOf("unosim-compile-sandbox:test") + 1)).toEqual([
      "unosim-compile", "60", "compile", "--fqbn", "arduino:avr:uno", "--verbose", "/sketch/0f1e",
    ]);
    expect(options).toMatchObject({ timeout: 75_000, stdio: "pipe", maxOutputBytes: 32 * 1024 * 1024 });
  });

  it("returns HEX and ELF of a successful build with the memory summary", async () => {
    const stdout = "Sketch uses 882 bytes (2%) of program storage space. Maximum is 32256 bytes.\nGlobal variables use 9 bytes (0%) of dynamic memory, leaving 2039 bytes for local variables. Maximum is 2048 bytes.\n";
    const processExecutor = executor({
      code: 0,
      stdout: frame({ stdout, files: { "0f1e.ino.hex": "HEX", "0f1e.ino.with_bootloader.hex": "BOOT", "0f1e.ino.elf": "ELF" } }),
      stderr: "",
    });
    const result = await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno" }, processExecutor, SETTINGS);
    expect(result.success).toBe(true);
    expect(result.binary?.toString()).toBe("HEX");
    expect(result.elf?.toString()).toBe("ELF");
    expect(result.output).toContain("Sketch uses 882 bytes");
    expect(result.output).toContain("Board: Arduino UNO");
  });

  it("names the sketch sketch.ino and headers by their own name in diagnostics", async () => {
    const stderr = "/sketch/0f1e/0f1e.ino:3:5: error: 'foo' was not declared in this scope\n/sketch/0f1e/pins.h:1:1: error: expected ';'\n";
    const processExecutor = executor({ code: 0, stdout: frame({ exit: 1 }), stderr });
    const result = await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno" }, processExecutor, SETTINGS);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("sketch.ino:3:5: error");
    expect(result.errors).toContain("\npins.h:1:1: error");
    expect(result.errors).not.toContain("/sketch/");
    expect(result.parsedErrors?.[0]).toMatchObject({ line: 3, type: "error" });
  });

  it("treats a truncated stdout as a failed compile even when the CLI exited 0", async () => {
    const processExecutor = executor({ code: 0, stdout: frame({ truncated: true, files: { "0f1e.ino.hex": "HEX" } }), stderr: "" });
    const result = await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno" }, processExecutor, SETTINGS);
    expect(result.success).toBe(false);
    expect(result.binary).toBeUndefined();
  });

  it("reports the time limit inside the container (exit 137) as a timeout", async () => {
    const processExecutor = executor({ code: 0, stdout: frame({ exit: 137 }), stderr: "" });
    const result = await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno" }, processExecutor, SETTINGS);
    expect(result).toMatchObject({ success: false, errors: "Compilation timed out after 60 s." });
  });

  it.each([
    ["timeout", new ProcessTimeoutError(75_000), "Compilation timed out after 60 s."],
    ["output limit", new ProcessOutputLimitError(32 * 1024 * 1024), "Compilation stopped: the compiler output exceeded its limit."],
  ])("removes the container when the docker client was killed (%s)", async (_label, error, message) => {
    const processExecutor = executor({ code: -1, stdout: "unosim-compile-result 1\n", stderr: "", error });
    const result = await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno" }, processExecutor, SETTINGS);
    expect(result).toMatchObject({ success: false, errors: message });
    const name = valueAfter(processExecutor.execute.mock.calls[0][1], "--name")[0];
    expect(processExecutor.execute).toHaveBeenLastCalledWith("docker", ["rm", "-f", name], expect.objectContaining({ timeout: 10_000 }));
  });

  it("names the missing sandbox without docker's own message when docker fails", async () => {
    const processExecutor = executor({ code: 125, stdout: "", stderr: "Unable to find image 'unosim-compile-sandbox:test' locally", error: new Error("docker exit code 125") });
    const result = await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno" }, processExecutor, SETTINGS);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("The compile sandbox is not available");
    expect(result.parsedErrors?.[0]).toMatchObject({ file: "system", type: "error" });
    expect(processExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it("reports a container killed from outside (exit 137 without frame) as stopped", async () => {
    const processExecutor = executor({ code: 137, stdout: "", stderr: "", error: new Error("docker exit code 137") });
    const result = await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno" }, processExecutor, SETTINGS);
    expect(result.errors).toContain("ran out of memory or was stopped");
  });
});

describe("runCliJsonInSandbox", () => {
  it("queries the toolchain in a container without any mount", async () => {
    const processExecutor = executor({ code: 0, stdout: '{"VersionString":"1.5.1"}', stderr: "" });
    expect(await runCliJsonInSandbox(["version", "--format", "json"], processExecutor, SETTINGS)).toEqual({ VersionString: "1.5.1" });
    const args = processExecutor.execute.mock.calls[0][1] as string[];
    expect(args).not.toContain("-v");
    expect(valueAfter(args, "--network")).toEqual(["none"]);
    expect(args.slice(-5)).toEqual(["unosim-compile-sandbox:test", "arduino-cli", "version", "--format", "json"]);
  });

  it("answers null when the container fails or prints no JSON", async () => {
    expect(await runCliJsonInSandbox(["version"], executor({ code: 125, stdout: "", stderr: "x" }), SETTINGS)).toBeNull();
    expect(await runCliJsonInSandbox(["version"], executor({ code: 0, stdout: "not json", stderr: "" }), SETTINGS)).toBeNull();
  });
});

describe("compile containers in capacity runs", () => {
  it("carry the capacity run label next to the owner label, like the simulation sandboxes", async () => {
    const processExecutor = executor({ code: 0, stdout: frame({ exit: 1 }), stderr: "" });
    await compileInSandbox(SKETCH, { fqbn: "arduino:avr:uno" }, processExecutor, { ...SETTINGS, capacityTestRunId: "cap-run-1" });
    expect(valueAfter(processExecutor.execute.mock.calls[0][1], "--label")).toEqual(["unosim.owner=test-host:42", "unosim.capacity-test-run-id=cap-run-1"]);
  });
});

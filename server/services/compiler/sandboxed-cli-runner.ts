import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import { Logger } from "@shared/logger";
import { config as appConfig } from "../../config";
import { MAX_COMPILER_OUTPUT_BYTES } from "../compiler-diagnostics";
import { DockerCommandBuilder } from "../docker-command-builder";
import type { ProcessExecution } from "../process-execution-port";
import { ProcessExecutor, ProcessOutputLimitError, ProcessTimeoutError } from "../process-executor";
import { SANDBOX_OWNER_LABEL, sandboxOwner } from "../sandbox/orphan-sweep";
import { type BuildFiles, buildCompileArgs, type CLICompileConfig, type CLICompileResult, interpretCliRun, systemFailure } from "./cli-runner";

const logger = new Logger("SandboxedCLIRunner");

/** Compile containers are named with this prefix; the owner label ties them to the backend for the orphan sweep. */
export const COMPILE_CONTAINER_PREFIX = "unosim-compile-";
/** Where the sketch directory appears in the container. */
const SKETCH_MOUNT_ROOT = "/sketch";
/** Time for container start and result framing on top of the compile time limit. */
const CONTAINER_GRACE_MS = 15_000;
/** Diagnostics on stderr, plus the framed stdout (base64 of up to 8 MiB) and the HEX/ELF files. */
const MAX_SANDBOX_OUTPUT_BYTES = 4 * MAX_COMPILER_OUTPUT_BYTES;

export interface CompileSandboxSettings {
  readonly image: string;
  readonly memoryMB: number;
  readonly cpuLimit: string;
  readonly pidsLimit: number;
  readonly tmpfsMB: number;
  readonly timeoutMs: number;
  readonly owner: string;
}

export function compileSandboxSettings(): CompileSandboxSettings {
  return { ...appConfig.compilation.sandbox, timeoutMs: appConfig.compilation.timeoutMs, owner: sandboxOwner() };
}

/** What the container's entry point (`scripts/compile-sandbox-entry.sh`) printed on stdout. */
export interface CompileFrame {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stdoutTruncated: boolean;
  readonly files: BuildFiles;
}

const FRAME_HEADER = "unosim-compile-result 1";

/** The frame, or undefined when it is incomplete (container stopped) or malformed. */
export function parseCompileFrame(output: string): CompileFrame | undefined {
  const lines = output.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== FRAME_HEADER || lines.at(-1) !== "end") return undefined;
  const exit = /^exit (\d+)$/.exec(lines[1] ?? "");
  const truncated = /^truncated ([01])$/.exec(lines[2] ?? "");
  const stdout = /^stdout ([A-Za-z0-9+/=]*)$/.exec(lines[3] ?? "");
  if (!exit || !truncated || !stdout) return undefined;
  const files = new Map<string, Buffer>();
  for (const line of lines.slice(4, -1)) {
    const file = /^file ([A-Za-z0-9._-]+) ([A-Za-z0-9+/=]*)$/.exec(line);
    if (!file) return undefined;
    files.set(file[1], Buffer.from(file[2], "base64"));
  }
  return {
    exitCode: Number(exit[1]),
    stdout: Buffer.from(stdout[1], "base64").toString("utf8"),
    stdoutTruncated: truncated[1] === "1",
    files,
  };
}

/**
 * `arduino-cli compile` in a short-lived compile container (plan P2.4) with the
 * same contract as `compileWithArduinoCli`. The sketch directory is the only
 * bind mount and read-only; the build runs in the container's tmpfs, and the
 * HEX and ELF come back framed on stdout. Diagnostics name the sketch
 * `sketch.ino`, never a host or container path.
 */
export async function compileInSandbox(
  sketchFile: string,
  config: CLICompileConfig,
  processExecutor: ProcessExecution = new ProcessExecutor(),
  settings: CompileSandboxSettings = compileSandboxSettings(),
): Promise<CLICompileResult> {
  const sketchDir = dirname(sketchFile);
  const mountTarget = `${SKETCH_MOUNT_ROOT}/${basename(sketchDir)}`;
  const containerName = `${COMPILE_CONTAINER_PREFIX}${randomUUID()}`;
  const timeoutSeconds = Math.ceil(settings.timeoutMs / 1000);
  const command = DockerCommandBuilder.buildCompileSandboxCommand({
    sketch: { dir: sketchDir, target: mountTarget },
    memoryMB: settings.memoryMB,
    cpuLimit: settings.cpuLimit,
    pidsLimit: settings.pidsLimit,
    tmpfsMB: settings.tmpfsMB,
    imageName: settings.image,
    containerName,
    labels: [`${SANDBOX_OWNER_LABEL}=${settings.owner}`],
    // The build path is the container's own; only FQBN and sketch matter here.
    command: ["unosim-compile", String(timeoutSeconds), ...buildCompileArgs({ fqbn: config.fqbn }, mountTarget)],
  });

  const result = await runContainer(processExecutor, command, containerName, {
    timeout: settings.timeoutMs + CONTAINER_GRACE_MS,
    maxOutputBytes: MAX_SANDBOX_OUTPUT_BYTES,
  });
  const frame = parseCompileFrame(result.stdout ?? "");
  if (!frame) {
    return systemFailure(frameFailureMessage(result, timeoutSeconds));
  }
  if (frame.exitCode === 137) return systemFailure(`Compilation timed out after ${timeoutSeconds} s.`);

  return interpretCliRun(
    // Like the local output limit: a flood is a failed compile with truncated output.
    { code: frame.stdoutTruncated && frame.exitCode === 0 ? 1 : frame.exitCode, stdout: frame.stdout, stderr: result.stderr ?? "" },
    { config, sketchFile: `${mountTarget}/${basename(sketchFile)}`, outputs: async () => frame.files },
  );
}

/** `docker run`; a killed client leaves its container running, so it is removed then. */
async function runContainer(
  processExecutor: ProcessExecution,
  command: string[],
  containerName: string,
  limits: { timeout: number; maxOutputBytes: number },
): Promise<Awaited<ReturnType<ProcessExecution["execute"]>>> {
  const result = await processExecutor.execute("docker", command, { ...limits, stdio: "pipe" });
  if (result.error instanceof ProcessTimeoutError || result.error instanceof ProcessOutputLimitError) {
    await processExecutor.execute("docker", ["rm", "-f", containerName], { timeout: 10_000, stdio: "pipe" }).catch(() => undefined);
  }
  return result;
}

function frameFailureMessage(result: { code: number; error?: Error }, timeoutSeconds: number): string {
  if (result.error instanceof ProcessTimeoutError) return `Compilation timed out after ${timeoutSeconds} s.`;
  if (result.error instanceof ProcessOutputLimitError) return "Compilation stopped: the compiler output exceeded its limit.";
  logger.error(`Compile sandbox ended without a result (exit ${result.code}${result.error ? `, ${result.error.name}` : ""})`);
  // Docker reports its own failures (daemon, missing image) with 125; a killed container with 137.
  return result.code === 137
    ? "Compilation stopped: the compile sandbox ran out of memory or was stopped."
    : "The compile sandbox is not available. Make sure Docker runs and the image is built (npm run build:compile-sandbox).";
}

/**
 * `arduino-cli <args>` with JSON output in a compile container, for the
 * toolchain information of the build identity (plan E15); null on any failure,
 * like `execArduinoCliJson`.
 */
export async function runCliJsonInSandbox(
  args: string[],
  processExecutor: ProcessExecution = new ProcessExecutor(),
  settings: CompileSandboxSettings = compileSandboxSettings(),
): Promise<unknown> {
  const containerName = `${COMPILE_CONTAINER_PREFIX}${randomUUID()}`;
  const command = DockerCommandBuilder.buildCompileSandboxCommand({
    memoryMB: settings.memoryMB,
    cpuLimit: settings.cpuLimit,
    pidsLimit: settings.pidsLimit,
    tmpfsMB: settings.tmpfsMB,
    imageName: settings.image,
    containerName,
    labels: [`${SANDBOX_OWNER_LABEL}=${settings.owner}`],
    command: ["arduino-cli", ...args],
  });
  const result = await runContainer(processExecutor, command, containerName, { timeout: CONTAINER_GRACE_MS, maxOutputBytes: MAX_COMPILER_OUTPUT_BYTES });
  if (result.code !== 0 || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

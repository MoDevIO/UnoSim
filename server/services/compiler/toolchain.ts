import { config, type ServerMode } from "../../config";
import type { ProcessExecution } from "../process-execution-port";
import { execArduinoCliJson } from "../workers/compile-worker-utils";
import { type CLICompileConfig, type CLICompileResult, compileWithArduinoCli } from "./cli-runner";
import { compileInSandbox, readSandboxProvidedLibraries, runCliJsonInSandbox } from "./sandboxed-cli-runner";
import { type ProvidedLibrary, readProvidedLibraries } from "../libraries/library-service";

/**
 * Where `arduino-cli` runs (plan P2.4): directly in the backend in the local
 * profile, in one compile container per call in the Docker profile. Every
 * compile and every toolchain query of a profile goes through the same one, so
 * the build identity describes the toolchain that actually built the image.
 */
export interface ArduinoToolchain {
  readonly kind: "local" | "sandbox";
  compile(sketchFile: string, cliConfig: CLICompileConfig, processExecutor: ProcessExecution): Promise<CLICompileResult>;
  /** `arduino-cli <args>` with JSON output; null on any failure. */
  queryJson(args: string[]): Promise<unknown>;
  /** The library packages provisioned for this toolchain, with the directories it sees (SSOT Libraries §10). */
  providedLibraries(): Promise<ProvidedLibrary[]>;
}

const LOCAL: ArduinoToolchain = {
  kind: "local",
  compile: (sketchFile, cliConfig, processExecutor) => compileWithArduinoCli(sketchFile, cliConfig, processExecutor),
  queryJson: execArduinoCliJson,
  // Read for every compile: provisioning while the server runs takes effect without a restart.
  providedLibraries: () => readProvidedLibraries(config.compilation.librariesDir),
};

let sandboxLibraries: Promise<ProvidedLibrary[]> | undefined;

const SANDBOX: ArduinoToolchain = {
  kind: "sandbox",
  compile: (sketchFile, cliConfig, processExecutor) => compileInSandbox(sketchFile, cliConfig, processExecutor),
  queryJson: (args) => runCliJsonInSandbox(args),
  // The image does not change while the server runs; an empty answer is asked again.
  providedLibraries: async () => {
    sandboxLibraries ??= readSandboxProvidedLibraries();
    const provided = await sandboxLibraries;
    if (provided.length === 0) sandboxLibraries = undefined;
    return provided;
  },
};

export function arduinoToolchain(serverMode: ServerMode = config.serverMode): ArduinoToolchain {
  return serverMode === "docker" ? SANDBOX : LOCAL;
}

/**
 * Whether `POST /api/compile` may return the flash image (plan 4.10): only
 * when it was built where no backend file was readable – in the compile
 * sandbox – or in the local profile, which serves one trusted developer.
 */
export function artifactDeliveryAllowed(serverMode: ServerMode = config.serverMode): boolean {
  return serverMode === "local" || arduinoToolchain(serverMode).kind === "sandbox";
}

/**
 * Startup check (plan 4.11): in the Docker profile every compile needs the
 * compile sandbox image, whichever runtime backends are offered, so the backend
 * does not start without it – as it does not without the sandbox image of the host mock.
 */
export async function assertCompileSandboxImage(
  processExecutor: ProcessExecution,
  image: string = config.compilation.sandbox.image,
  serverMode: ServerMode = config.serverMode,
): Promise<void> {
  if (arduinoToolchain(serverMode).kind !== "sandbox") return;
  const inspected = await processExecutor.execute("docker", ["image", "inspect", image], {
    timeout: config.sandbox.dockerControlTimeoutMs,
    stdio: "pipe",
  });
  if (inspected.code !== 0) {
    throw new Error(`Compile sandbox image ${image} is not available; build it with npm run build:compile-sandbox (COMPILE_SANDBOX_IMAGE)`);
  }
}

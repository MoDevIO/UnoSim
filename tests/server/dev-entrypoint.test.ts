import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";

const removedRuntimeSelectors = [
  "UNOSIM_SIMULATION_MODE",
  "UNOSIM_TRUST_MODE",
  "FORCE_DOCKER",
  "UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL",
  "UNOSIM_DOCKER_TEST_BYPASS_GATEWAY",
];

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not reserve a local test port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function createLocalServerEnv(port: number): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of removedRuntimeSelectors) delete env[key];
  Object.assign(env, {
    NODE_ENV: "development",
    UNOSIM_SERVER_MODE: "local",
    PORT: String(port),
    UNOSIM_LISTEN_HOST: "127.0.0.1",
    LOG_LEVEL: "error",
  });
  return env;
}

function spawnLocalDevelopment(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ["scripts/start-local-dev.mjs"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

function collectOutput(child: ChildProcess): () => string {
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  return () => output;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForProcessTreeExit(child: ChildProcess, pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const groupAlive = process.platform !== "win32" && isProcessGroupAlive(pid);
    if (hasExited(child) && !groupAlive) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return hasExited(child) && (process.platform === "win32" || !isProcessGroupAlive(pid));
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.stdout?.destroyed && child.stderr?.destroyed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (closed: boolean) => {
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", onClose);
  });
}

async function stopProcess(child: ChildProcess, gracefulSignal: NodeJS.Signals = "SIGINT"): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) {
    if (!await waitForClose(child, 1_000)) throw new Error("Local development launcher did not close after failing to spawn");
    return;
  }

  if (!hasExited(child)) child.kill(gracefulSignal);
  if (!await waitForProcessTreeExit(child, pid, 1_500)) {
    if (process.platform === "win32") child.kill("SIGTERM");
    else signalProcessGroup(pid, "SIGTERM");
    if (!await waitForProcessTreeExit(child, pid, 1_000)) {
      if (process.platform === "win32") child.kill("SIGKILL");
      else signalProcessGroup(pid, "SIGKILL");
      if (!await waitForProcessTreeExit(child, pid, 1_000)) {
        throw new Error(`Local development process tree ${pid} did not stop after SIGKILL`);
      }
    }
  }

  if (!await waitForClose(child, 1_000)) {
    throw new Error(`Local development launcher ${pid} exited but its stdio did not close`);
  }
}

async function waitForReadiness(child: ChildProcess, port: number, output: () => string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (hasExited(child)) {
      throw new Error(`Development server exited before readiness:\n${output()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/readiness`);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for development readiness:\n${output()}`);
}

describe("local development entrypoint", () => {
  it("ignores inherited removed runtime selectors while preserving local startup and capacity overrides", async () => {
    const port = await reservePort();
    const env = createLocalServerEnv(port);
    Object.assign(env, {
      UNOSIM_SIMULATION_MODE: "docker",
      UNOSIM_TRUST_MODE: "gateway",
      FORCE_DOCKER: "1",
      UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL: "1",
      UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1",
      WORKER_COUNT: "3",
      COMPILE_MAX_CONCURRENT: "4",
    });

    const child = spawnLocalDevelopment(env);
    const output = collectOutput(child);
    try {
      await waitForReadiness(child, port, output);
      expect(output()).toContain("Server Mode:          local");
      expect(output()).toContain("Trust Mode:           local");
      expect(output()).toContain("NODE_ENV:             development");
      expect(output()).toContain("Compile Workers:      3");
      expect(output()).toContain("Compile Slots:        4");
      expect(output()).not.toContain("is no longer supported");
    } finally {
      await stopProcess(child);
    }
    expect(output()).toContain("[Shutdown] Received SIGINT");
    expect(child.exitCode).toBe(0);
  }, 20_000);

  it("forwards SIGTERM to the server and exits cleanly", async () => {
    const port = await reservePort();
    const child = spawnLocalDevelopment(createLocalServerEnv(port));
    const output = collectOutput(child);
    try {
      await waitForReadiness(child, port, output);
    } finally {
      await stopProcess(child, "SIGTERM");
    }
    expect(output()).toContain("[Shutdown] Received SIGTERM");
    expect(child.exitCode).toBe(0);
  }, 20_000);
});

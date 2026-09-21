import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";

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

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const finish = () => resolve();
    child.once("close", finish);
    child.kill("SIGINT");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }, 2_000).unref();
  });
}

async function waitForReadiness(child: ChildProcess, port: number, output: () => string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
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
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const env = { ...process.env };
    for (const key of [
      "UNOSIM_SIMULATION_MODE",
      "UNOSIM_TRUST_MODE",
      "FORCE_DOCKER",
      "UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL",
      "UNOSIM_DOCKER_TEST_BYPASS_GATEWAY",
    ]) {
      delete env[key];
    }
    Object.assign(env, {
      NODE_ENV: "development",
      UNOSIM_SERVER_MODE: "local",
      UNOSIM_SIMULATION_MODE: "docker",
      UNOSIM_TRUST_MODE: "gateway",
      FORCE_DOCKER: "1",
      UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL: "1",
      UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1",
      WORKER_COUNT: "3",
      COMPILE_MAX_CONCURRENT: "4",
      PORT: String(port),
      UNOSIM_LISTEN_HOST: "127.0.0.1",
      LOG_LEVEL: "error",
    });

    const child = spawn(npmCommand, ["run", "dev"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

    try {
      await waitForReadiness(child, port, () => output);
      expect(output).toContain("Server Mode:          local");
      expect(output).toContain("Trust Mode:           local");
      expect(output).toContain("NODE_ENV:             development");
      expect(output).toContain("Compile Workers:      3");
      expect(output).toContain("Compile Slots:        4");
      expect(output).not.toContain("is no longer supported");
    } finally {
      await stopProcess(child);
    }
  }, 20_000);
});

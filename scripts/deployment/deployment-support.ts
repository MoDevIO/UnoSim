import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import WebSocket from "ws";

/** Shared process, HTTPS and WebSocket helpers of the deployment tests. */

export type CommandResult = { code: number; stdout: string; stderr: string };
export type HttpResult = { statusCode: number; headers: IncomingHttpHeaders; body: string };

export const blinkSketch = `void setup() { Serial.begin(9600); pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(13, HIGH); Serial.println("LED ON"); delay(500);
  digitalWrite(13, LOW); Serial.println("LED OFF"); delay(500);
}`;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
        }, options.timeoutMs)
      : undefined;

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    if (options.input !== undefined) child.stdin?.end(options.input);
    child.once("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (settled) return;
      settled = true;
      resolve({
        code: code ?? (signal ? 1 : 0),
        stdout,
        stderr: signal ? `${stderr}\nprocess signal: ${signal}` : stderr,
      });
    });
  });
}

export async function checked(
  command: string,
  args: string[],
  options: Parameters<typeof runCommand>[2] = {},
): Promise<CommandResult> {
  const result = await runCommand(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.code})\n${result.stderr || result.stdout}`);
  }
  return result;
}

export async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert(address && typeof address !== "string", "could not determine a free port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Fails fast when a fixed port the topology needs is already taken. */
export async function assertPortFree(port: number): Promise<void> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    // Unprivileged runners may not bind low ports themselves; only a port that
    // is already in use is a definite conflict.
    if ((error as NodeJS.ErrnoException).code === "EACCES") return;
    throw new Error(`127.0.0.1:${port} is required by the deployment topology but unavailable: ${String(error)}`);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export async function httpsRequest(
  target: { port: number; ca: Buffer; host?: string },
  requestPath: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: target.host ?? "127.0.0.1",
        port: target.port,
        path: requestPath,
        method: options.method ?? "GET",
        ca: target.ca,
        rejectUnauthorized: true,
        headers: options.headers,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.once("end", () => resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body,
        }));
      },
    );
    request.setTimeout(options.timeoutMs ?? 20_000, () => request.destroy(new Error("HTTPS request timed out")));
    request.once("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

export async function waitFor(
  description: string,
  probe: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  const suffix = lastError ? `: ${String(lastError)}` : "";
  throw new Error(`Timed out waiting for ${description}${suffix}`);
}

export function parseJson(body: string): Record<string, any> {
  return JSON.parse(body) as Record<string, any>;
}

export async function listContainerNames(): Promise<Set<string>> {
  const result = await checked("docker", ["ps", "-a", "--format", "{{.Names}}"]);
  return new Set(result.stdout.split("\n").map((line) => line.trim()).filter(Boolean));
}

export async function resolveDockerGid(): Promise<string> {
  if (process.env.DOCKER_GID) return process.env.DOCKER_GID;
  for (const args of [["-c", "%g", "/var/run/docker.sock"], ["-f", "%g", "/var/run/docker.sock"]]) {
    const result = await runCommand("stat", args);
    if (result.code === 0 && /^\d+$/.test(result.stdout.trim())) return result.stdout.trim();
  }
  return "0";
}

/**
 * Uses images built by CI when given, otherwise builds both from the working
 * tree. Returns whether the images belong to this run and must be removed.
 */
export async function prepareImages(runId: string): Promise<{ server: string; sandbox: string; owned: boolean }> {
  const prebuiltServer = process.env.DEPLOYMENT_PREBUILT_SERVER_IMAGE;
  const prebuiltSandbox = process.env.DEPLOYMENT_PREBUILT_SANDBOX_IMAGE;
  if (prebuiltServer && prebuiltSandbox) {
    await checked("docker", ["image", "inspect", prebuiltServer], { timeoutMs: 20_000 });
    await checked("docker", ["image", "inspect", prebuiltSandbox], { timeoutMs: 20_000 });
    return { server: prebuiltServer, sandbox: prebuiltSandbox, owned: false };
  }
  const server = `unosim-server:deployment-${runId}`;
  const sandbox = `unosim-sandbox:deployment-${runId}`;
  console.log(`[deployment] building ${sandbox}`);
  await checked("docker", ["build", "-f", "Dockerfile.sandbox", "-t", sandbox, "."], { timeoutMs: 900_000 });
  console.log(`[deployment] building ${server}`);
  await checked("docker", ["build", "-t", server, "."], { timeoutMs: 1_800_000 });
  return { server, sandbox, owned: true };
}

export async function createTestCertificate(directory: string, names: { certificate: string; key: string }): Promise<Buffer> {
  const certificate = `${directory}/${names.certificate}`;
  await checked("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", `${directory}/${names.key}`, "-out", certificate,
    "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { timeoutMs: 30_000 });
  return readFile(certificate);
}

export function openWebSocket(
  target: { port: number; ca: Buffer },
  origin: string,
  headers: Record<string, string> = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${target.port}/ws`, {
      ca: target.ca,
      rejectUnauthorized: true,
      headers: { Origin: origin, ...headers },
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket open timed out"));
    }, 20_000);
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.once("open", () => {
      clearTimeout(timer);
      socket.removeListener("error", onError);
      resolve(socket);
    });
    socket.once("error", onError);
  });
}

export function nextWebSocketMessage(
  socket: WebSocket,
  predicate: (message: Record<string, any>) => boolean,
  timeoutMs = 30_000,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener("message", onMessage);
      reject(new Error("timed out waiting for expected WebSocket message"));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const message = JSON.parse(raw.toString()) as Record<string, any>;
        if (!predicate(message)) return;
        clearTimeout(timer);
        socket.removeListener("message", onMessage);
        resolve(message);
      } catch (error) {
        clearTimeout(timer);
        socket.removeListener("message", onMessage);
        reject(error);
      }
    };
    socket.on("message", onMessage);
  });
}

export async function expectRejectedOrigin(target: { port: number; ca: Buffer }, origin = "https://invalid.example"): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${target.port}/ws`, {
      ca: target.ca,
      rejectUnauthorized: true,
      headers: { Origin: origin },
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket with origin ${origin} was not rejected`));
    }, 10_000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      socket.terminate();
      if (response.statusCode !== 403) {
        reject(new Error(`WebSocket with origin ${origin} returned ${response.statusCode}, expected 403`));
        return;
      }
      resolve();
    });
    socket.once("open", () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error(`WebSocket with origin ${origin} unexpectedly opened`));
    });
    socket.once("error", (error) => {
      // ws emits an error after some rejected handshakes; unexpected-response
      // remains the authoritative status check.
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET") return;
    });
  });
}

/** Removes sandbox containers this run created; reports them as a failure. */
export async function removeLeakedSandboxes(baseline: Set<string>): Promise<string[]> {
  const after = await listContainerNames();
  const leaked = [...after].filter((name) => !baseline.has(name) && name.startsWith("unosim-sandbox-"));
  for (const name of leaked) await runCommand("docker", ["rm", "-f", name], { timeoutMs: 20_000 });
  return leaked;
}

export function runAsScript(main: () => Promise<void>, label: string): void {
  main().catch((error: unknown) => {
    console.error(`[${label}] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  });
}

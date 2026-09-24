import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import WebSocket from "ws";

const composeFile = join(process.cwd(), "tests/deployment/docker-compose.gateway.yml");
const nginxTemplateFile = join(process.cwd(), "tests/deployment/nginx.conf.template");
const blinkSketch = `void setup() { Serial.begin(9600); pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(13, HIGH); Serial.println("LED ON"); delay(500);
  digitalWrite(13, LOW); Serial.println("LED OFF"); delay(500);
}`;

type CommandResult = { code: number; stdout: string; stderr: string };
type HttpResult = { statusCode: number; headers: IncomingHttpHeaders; body: string };

let trustedGatewayCertificate: Buffer | undefined;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
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

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
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

async function checked(command: string, args: string[], options: Parameters<typeof runCommand>[2] = {}): Promise<CommandResult> {
  const result = await runCommand(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.code})\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function findFreePort(): Promise<number> {
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

async function httpRequest(
  port: number,
  requestPath: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        method: options.method ?? "GET",
        ca: trustedGatewayCertificate,
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

async function waitFor(
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

function parseJson(body: string): Record<string, any> {
  return JSON.parse(body) as Record<string, any>;
}

async function listContainerNames(): Promise<Set<string>> {
  const result = await checked("docker", ["ps", "-a", "--format", "{{.Names}}"]);
  return new Set(result.stdout.split("\n").map((line) => line.trim()).filter(Boolean));
}

async function resolveDockerGid(): Promise<string> {
  if (process.env.DOCKER_GID) return process.env.DOCKER_GID;
  for (const args of [["-c", "%g", "/var/run/docker.sock"], ["-f", "%g", "/var/run/docker.sock"]]) {
    const result = await runCommand("stat", args);
    if (result.code === 0 && /^\d+$/.test(result.stdout.trim())) return result.stdout.trim();
  }
  return "0";
}

function openGatewayWebSocket(
  port: number,
  origin: string,
  headers: Record<string, string> = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${port}/ws`, {
      ca: trustedGatewayCertificate,
      rejectUnauthorized: true,
      headers: { Origin: origin, ...headers },
    });
    const onError = (error: Error) => reject(error);
    socket.once("open", () => {
      socket.removeListener("error", onError);
      resolve(socket);
    });
    socket.once("error", onError);
  });
}

function nextWebSocketMessage(
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

async function expectRejectedOrigin(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${port}/ws`, {
      ca: trustedGatewayCertificate,
      rejectUnauthorized: true,
      headers: { Origin: "https://invalid.example" },
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("invalid-origin WebSocket was not rejected"));
    }, 10_000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      socket.terminate();
      if (response.statusCode !== 403) {
        reject(new Error(`invalid-origin WebSocket returned ${response.statusCode}, expected 403`));
        return;
      }
      resolve();
    });
    socket.once("open", () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error("invalid-origin WebSocket unexpectedly opened"));
    });
    socket.once("error", (error) => {
      if (!socket.listenerCount("unexpected-response")) return;
      // ws emits an error after some rejected handshakes; unexpected-response
      // remains the authoritative status check.
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET") return;
    });
  });
}

async function compose(
  projectName: string,
  env: NodeJS.ProcessEnv,
  args: string[],
  timeoutMs = 120_000,
): Promise<CommandResult> {
  return checked("docker", ["compose", "-p", projectName, "-f", composeFile, ...args], { env, timeoutMs });
}

async function main(): Promise<void> {
  const runId = `${Date.now()}-${process.pid}`;
  const projectName = `unosim-deployment-test-${process.pid}`;
  const tempRoot = await mkdtemp(join(tmpdir(), "unosim-deployment-"));
  const tlsDir = join(tempRoot, "tls");
  const tempDir = join(tempRoot, "shared-temp");
  const nginxConfig = join(tempRoot, "nginx.conf");
  const serverImage = `unosim-server:deployment-${runId}`;
  const sandboxImage = `unosim-sandbox:deployment-${runId}`;
  const port = Number(process.env.DEPLOYMENT_TEST_PORT ?? await findFreePort());
  const gatewayOrigin = `https://127.0.0.1:${port}`;
  const gatewaySecret = `deployment-test-secret-${runId}-0123456789abcdef`;
  const dockerGid = await resolveDockerGid();
  const baselineContainers = await listContainerNames();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    DEPLOYMENT_SERVER_IMAGE: serverImage,
    DEPLOYMENT_SANDBOX_IMAGE: sandboxImage,
    DEPLOYMENT_GATEWAY_PORT: String(port),
    DEPLOYMENT_GATEWAY_ORIGIN: gatewayOrigin,
    DEPLOYMENT_GATEWAY_SECRET: gatewaySecret,
    DEPLOYMENT_TRUSTED_PROXY: "172.30.0.2/32",
    DEPLOYMENT_TEMP_DIR: tempDir,
    DEPLOYMENT_NGINX_CONFIG: nginxConfig,
    DEPLOYMENT_TLS_DIR: tlsDir,
    DOCKER_GID: dockerGid,
  };
  let stackStarted = false;
  let backendLogs = "";
  let socket: WebSocket | undefined;
  let cleanupError: Error | undefined;

  try {
    console.log(`[deployment] building ${sandboxImage}`);
    await checked("docker", ["build", "-f", "Dockerfile.sandbox", "-t", sandboxImage, "."], { timeoutMs: 900_000 });
    console.log(`[deployment] building ${serverImage}`);
    await checked("docker", ["build", "-t", serverImage, "."], { timeoutMs: 1_800_000 });

    await checked("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(tempRoot, "test.key"), "-out", join(tempRoot, "test.crt"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
    await checked("mkdir", ["-p", tlsDir, tempDir]);
    await checked("mv", [join(tempRoot, "test.key"), join(tlsDir, "test.key")]);
    await checked("mv", [join(tempRoot, "test.crt"), join(tlsDir, "test.crt")]);
    trustedGatewayCertificate = await readFile(join(tlsDir, "test.crt"));
    const nginxTemplate = await readFile(nginxTemplateFile, "utf8");
    await writeFile(nginxConfig, nginxTemplate.replaceAll("__RUNTIME_GATEWAY_SECRET__", gatewaySecret), "utf8");

    console.log(`[deployment] starting project ${projectName} on ${gatewayOrigin}`);
    await compose(projectName, env, ["up", "-d"], 180_000);
    stackStarted = true;

    await waitFor("gateway readiness", async () => {
      const response = await httpRequest(port, "/api/readiness", { timeoutMs: 5_000 });
      return response.statusCode === 200;
    }, 180_000);
    const staticResponse = await httpRequest(port, "/");
    assert.equal(staticResponse.statusCode, 200, "gateway must serve the production frontend");
    assert.match(staticResponse.body, /<div id=["']root["']/i, "production frontend root is missing");

    const statusResponse = await httpRequest(port, "/api/status");
    assert.equal(statusResponse.statusCode, 200, "authenticated status request through gateway must succeed");
    const initialStatus = parseJson(statusResponse.body);
    assert.equal(initialStatus.serverMode, "docker");
    assert.equal(initialStatus.sandboxRunners.max, 1);
    const configResponse = await httpRequest(port, "/api/config");
    assert.equal(configResponse.statusCode, 200, "authenticated config request through gateway must succeed");
    assert.deepEqual(parseJson(configResponse.body).tutor, { provider: "kiconnect" });
    const missingTutorCredential = await httpRequest(port, "/api/tutor/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(missingTutorCredential.statusCode, 400);
    assert.equal(parseJson(missingTutorCredential.body).error.code, "CREDENTIAL_REQUIRED");
    await compose(projectName, env, ["exec", "-T", "unosim-backend", "node", "-e", "process.exit(process.env.UNOSIM_DOCKER_TEST_BYPASS_GATEWAY === undefined ? 0 : 1)"], 20_000);
    await compose(projectName, env, ["exec", "-T", "unosim-backend", "node", "-e", "process.exit(process.env.UNOSIM_TUTOR_MODE === undefined && process.env.UNOSIM_LLM_API_KEY === undefined ? 0 : 1)"], 20_000);

    const spoofedResponse = await httpRequest(port, "/api/status", {
      headers: {
        "X-UnoSim-Gateway-Secret": "attacker-secret",
        "X-UnoSim-Subject": "attacker",
        "X-UnoSim-Roles": "user",
      },
    });
    assert.equal(spoofedResponse.statusCode, 200, "gateway must overwrite spoofed identity headers");

    const directPort = await runCommand("docker", ["compose", "-p", projectName, "-f", composeFile, "port", "unosim-backend", "3000"], { env });
    assert.ok(
      directPort.stdout.trim() === "" || directPort.stdout.trim() === "invalid IP:0",
      `backend must not publish a host port (compose port output: ${directPort.stdout.trim()})`,
    );
    const directResponse = await compose(projectName, env, ["exec", "-T", "unosim-backend", "node", "-e", "fetch('http://127.0.0.1:3000/api/status').then((r) => process.exit(r.status === 401 || r.status === 403 ? 0 : 1))"], 20_000);
    assert.equal(directResponse.code, 0, "direct backend access without gateway credentials must be rejected");

    await expectRejectedOrigin(port);
    socket = await openGatewayWebSocket(port, gatewayOrigin, {
      "X-UnoSim-Gateway-Secret": "attacker-secret",
      "X-UnoSim-Subject": "attacker",
      "X-UnoSim-Roles": "user",
    });
    await nextWebSocketMessage(socket, (message) => message.type === "simulation_status" && message.status === "stopped");
    let socketClosed = false;
    socket.once("close", () => { socketClosed = true; });
    await sleep(1_000);
    assert.equal(socketClosed, false, "valid WebSocket must remain connected through the gateway");

    const compileResponse = await httpRequest(port, "/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: blinkSketch }),
      timeoutMs: 180_000,
    });
    assert.equal(compileResponse.statusCode, 200, `compile through gateway returned ${compileResponse.statusCode}`);
    assert.equal(parseJson(compileResponse.body).success, true, "compile through gateway must succeed");

    socket.send(JSON.stringify({ type: "start_simulation", code: blinkSketch }));
    await nextWebSocketMessage(socket, (message) => message.type === "simulation_status" && message.status === "running", 180_000);
    const activeContainers = await listContainerNames();
    const newSandboxContainers = [...activeContainers].filter((name) => name.startsWith("unosim-sandbox-") && !baselineContainers.has(name));
    assert.ok(newSandboxContainers.length > 0, "running simulation must use a Docker sandbox container");

    socket.send(JSON.stringify({ type: "stop_simulation" }));
    await nextWebSocketMessage(socket, (message) => message.type === "simulation_status" && message.status === "stopped", 60_000);
    await waitFor("sandbox runner release", async () => {
      const response = await httpRequest(port, "/api/status");
      if (response.statusCode !== 200) return false;
      const status = parseJson(response.body);
      return status.sandboxRunners.inUse === 0 && status.webSocketSessions.running === 0;
    }, 60_000);

    backendLogs = (await compose(projectName, env, ["logs", "--no-color", "unosim-backend"], 20_000)).stdout;
    assert.match(backendLogs, /Server Mode:\s+docker/);
    assert.match(backendLogs, /Trust Mode:\s+gateway/);
    assert.match(backendLogs, /NODE_ENV:\s+production/);
    assert.doesNotMatch(backendLogs, /UNOSIM_DOCKER_TEST_BYPASS_GATEWAY/);

    console.log("[deployment] stopping stack with the WebSocket still connected");
    await compose(projectName, env, ["stop", "-t", "15"], 30_000);
    await waitFor("gateway WebSocket close during shutdown", async () => socket?.readyState === WebSocket.CLOSED, 5_000);
    backendLogs = (await compose(projectName, env, ["logs", "--no-color", "unosim-backend"], 20_000)).stdout;
    assert.match(backendLogs, /Graceful shutdown complete/);
    assert.doesNotMatch(backendLogs, /Force shutdown after 10s timeout/);
  } finally {
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
    if (stackStarted) {
      try {
        await compose(projectName, env, ["down", "--remove-orphans", "-v"], 60_000);
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error(String(error));
      }
    }
    try {
      const afterContainers = await listContainerNames();
      const leaked = [...afterContainers].filter((name) => !baselineContainers.has(name) && name.startsWith("unosim-sandbox-"));
      for (const name of leaked) await runCommand("docker", ["rm", "-f", name], { timeoutMs: 20_000 });
      if (leaked.length > 0) {
        cleanupError ??= new Error(`deployment test left sandbox containers: ${leaked.join(", ")}`);
      }
    } catch (error) {
      cleanupError ??= error instanceof Error ? error : new Error(String(error));
    }
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (cleanupError) {
    throw cleanupError;
  }
  if (/Force shutdown after 10s timeout/.test(backendLogs)) {
    throw new Error("backend required forced shutdown");
  }
  console.log("[deployment] production gateway smoke test passed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(`[deployment] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  }
}

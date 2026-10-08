import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  blinkSketch,
  checked,
  type CommandResult,
  createTestCertificate,
  expectRejectedOrigin,
  findFreePort,
  httpsRequest,
  listContainerNames,
  nextWebSocketMessage,
  openWebSocket,
  parseJson,
  prepareImages,
  removeLeakedSandboxes,
  resolveDockerGid,
  runAsScript,
  runCommand,
  sleep,
  waitFor,
} from "./deployment-support";

/**
 * Containerised gateway topology: Nginx runs as a container on the backend's
 * network, so the trusted proxy is the Nginx container address.
 */
const composeFile = join(process.cwd(), "tests/deployment/docker-compose.gateway.yml");
const nginxTemplateFile = join(process.cwd(), "tests/deployment/nginx.conf.template");

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
  const port = Number(process.env.DEPLOYMENT_TEST_PORT ?? await findFreePort());
  const gatewayOrigin = `https://127.0.0.1:${port}`;
  const gatewaySecret = `deployment-test-secret-${runId}-0123456789abcdef`;
  const dockerGid = await resolveDockerGid();
  const baselineContainers = await listContainerNames();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    DEPLOYMENT_GATEWAY_PORT: String(port),
    DEPLOYMENT_GATEWAY_ORIGIN: gatewayOrigin,
    DEPLOYMENT_GATEWAY_SECRET: gatewaySecret,
    DEPLOYMENT_TRUSTED_PROXY: "172.30.0.2/32",
    DEPLOYMENT_TEMP_DIR: tempDir,
    DEPLOYMENT_NGINX_CONFIG: nginxConfig,
    DEPLOYMENT_TLS_DIR: tlsDir,
    DOCKER_GID: dockerGid,
  };
  let images: Awaited<ReturnType<typeof prepareImages>> | undefined;
  let stackStarted = false;
  let backendLogs = "";
  let socket: WebSocket | undefined;
  let cleanupError: Error | undefined;

  try {
    images = await prepareImages(runId);
    env.DEPLOYMENT_SERVER_IMAGE = images.server;
    env.DEPLOYMENT_SANDBOX_IMAGE = images.sandbox;

    await mkdir(tlsDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });
    // The backend's container user differs from the runner user on Linux CI.
    await chmod(tempDir, 0o777);
    const ca = await createTestCertificate(tlsDir, { certificate: "test.crt", key: "test.key" });
    const gateway = { port, ca };
    const nginxTemplate = await readFile(nginxTemplateFile, "utf8");
    await writeFile(nginxConfig, nginxTemplate.replaceAll("__RUNTIME_GATEWAY_SECRET__", gatewaySecret), "utf8");

    console.log(`[deployment] starting project ${projectName} on ${gatewayOrigin}`);
    await compose(projectName, env, ["up", "-d"], 180_000);
    stackStarted = true;

    await waitFor("gateway readiness", async () => {
      const response = await httpsRequest(gateway, "/api/readiness", { timeoutMs: 5_000 });
      return response.statusCode === 200;
    }, 180_000);
    const staticResponse = await httpsRequest(gateway, "/");
    assert.equal(staticResponse.statusCode, 200, "gateway must serve the production frontend");
    assert.match(staticResponse.body, /<div id=["']root["']/i, "production frontend root is missing");

    const statusResponse = await httpsRequest(gateway, "/api/status");
    assert.equal(statusResponse.statusCode, 200, "authenticated status request through gateway must succeed");
    const initialStatus = parseJson(statusResponse.body);
    assert.equal(initialStatus.serverMode, "docker");
    assert.equal(initialStatus.sandboxRunners.max, 1);
    const configResponse = await httpsRequest(gateway, "/api/config");
    assert.equal(configResponse.statusCode, 200, "authenticated config request through gateway must succeed");
    assert.deepEqual(parseJson(configResponse.body).tutor, { provider: "kiconnect" });
    const missingTutorCredential = await httpsRequest(gateway, "/api/tutor/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(missingTutorCredential.statusCode, 400);
    assert.equal(parseJson(missingTutorCredential.body).error.code, "CREDENTIAL_REQUIRED");
    await compose(projectName, env, ["exec", "-T", "unosim-backend", "node", "-e", "process.exit(process.env.UNOSIM_DOCKER_TEST_BYPASS_GATEWAY === undefined ? 0 : 1)"], 20_000);
    await compose(projectName, env, ["exec", "-T", "unosim-backend", "node", "-e", "process.exit(process.env.UNOSIM_TUTOR_MODE === undefined && process.env.UNOSIM_LLM_API_KEY === undefined ? 0 : 1)"], 20_000);

    const spoofedResponse = await httpsRequest(gateway, "/api/status", {
      headers: {
        "X-UnoSim-Gateway-Secret": "attacker-secret",
        "X-UnoSim-Subject": "attacker",
        "X-UnoSim-Roles": "user",
      },
    });
    assert.equal(spoofedResponse.statusCode, 200, "gateway must overwrite spoofed identity headers");

    const backendId = (await compose(projectName, env, ["ps", "-q", "unosim-backend"], 20_000)).stdout.trim();
    const portBindings = (await checked("docker", [
      "inspect", backendId, "--format", "{{json .HostConfig.PortBindings}}",
    ], { timeoutMs: 20_000 })).stdout.trim();
    assert.ok(
      portBindings === "{}" || portBindings === "null",
      `backend must not publish a host port (port bindings: ${portBindings})`,
    );
    const directResponse = await compose(projectName, env, ["exec", "-T", "unosim-backend", "node", "-e", "fetch('http://127.0.0.1:3000/api/status').then((r) => process.exit(r.status === 401 || r.status === 403 ? 0 : 1))"], 20_000);
    assert.equal(directResponse.code, 0, "direct backend access without gateway credentials must be rejected");

    await expectRejectedOrigin(gateway);
    socket = await openWebSocket(gateway, gatewayOrigin, {
      "X-UnoSim-Gateway-Secret": "attacker-secret",
      "X-UnoSim-Subject": "attacker",
      "X-UnoSim-Roles": "user",
    });
    await nextWebSocketMessage(socket, (message) => message.type === "simulation_status" && message.status === "stopped");
    let socketClosed = false;
    socket.once("close", () => { socketClosed = true; });
    await sleep(1_000);
    assert.equal(socketClosed, false, "valid WebSocket must remain connected through the gateway");

    const compileResponse = await httpsRequest(gateway, "/api/compile", {
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
      const response = await httpsRequest(gateway, "/api/status");
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
      const leaked = await removeLeakedSandboxes(baselineContainers);
      if (leaked.length > 0) {
        cleanupError ??= new Error(`deployment test left sandbox containers: ${leaked.join(", ")}`);
      }
    } catch (error) {
      cleanupError ??= error instanceof Error ? error : new Error(String(error));
    }
    if (images) {
      // Files written by the container user may not be removable by the runner user.
      await runCommand("docker", [
        "run", "--rm", "--user", "0", "-v", `${tempRoot}:/cleanup`, "--entrypoint", "sh", images.server,
        "-c", "rm -rf /cleanup/shared-temp",
      ], { timeoutMs: 60_000 });
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
  runAsScript(main, "deployment");
}

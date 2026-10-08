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

/** Owner label contract of sandbox containers (server/services/sandbox/orphan-sweep.ts). */
async function sandboxIds(owner: string): Promise<string[]> {
  const listed = await checked("docker", ["ps", "-aq", "--filter", `label=unosim.owner=${owner}`], { timeoutMs: 20_000 });
  return listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Sandbox containers this run's backends started, independent of any label. */
async function startedSandboxes(baseline: Set<string>): Promise<string[]> {
  return [...await listContainerNames()].filter((name) => name.startsWith("unosim-sandbox-") && !baseline.has(name));
}

type Lifecycle = {
  compose: (args: string[], timeoutMs?: number) => Promise<CommandResult>;
  baseline: Set<string>;
  gateway: { port: number; ca: Buffer };
  origin: string;
  owner: string;
};

async function startRunningSimulation(lifecycle: Lifecycle): Promise<WebSocket> {
  const socket = await openWebSocket(lifecycle.gateway, lifecycle.origin);
  // All gateway sockets share one subject: one simulation start per 2 s.
  await sleep(2_200);
  socket.send(JSON.stringify({ type: "start_simulation", code: blinkSketch }));
  const outcome = await nextWebSocketMessage(
    socket,
    (message) => message.type === "operation_error" || (message.type === "simulation_status" && message.status === "running"),
    180_000,
  );
  assert.equal(outcome.type, "simulation_status", `simulation start was rejected: ${JSON.stringify(outcome)}`);
  return socket;
}

async function waitForGateway(gateway: Lifecycle["gateway"]): Promise<void> {
  await waitFor("gateway readiness", async () => {
    const response = await httpsRequest(gateway, "/api/readiness", { timeoutMs: 5_000 });
    return response.statusCode === 200;
  }, 180_000);
}

/**
 * Crash and redeploy: a SIGKILLed backend leaves its sandbox running; a new
 * backend container (new hostname) of the same deployment removes it at
 * startup, while a sandbox of another deployment stays untouched.
 */
async function verifyCrashRedeploySweep(lifecycle: Lifecycle, sandboxImage: string, foreignOwner: string): Promise<void> {
  console.log("[deployment] crash and redeploy with a running simulation");
  const socket = await startRunningSimulation(lifecycle);
  await checked("docker", [
    "run", "-d", "--rm", "--label", `unosim.owner=${foreignOwner}`, "--entrypoint", "sleep", sandboxImage, "600",
  ], { timeoutMs: 60_000 });
  const orphans = await startedSandboxes(lifecycle.baseline);
  assert.equal(orphans.length, 1, `exactly one sandbox must run before the crash (found ${orphans.length})`);

  await lifecycle.compose(["kill", "-s", "SIGKILL", "unosim-backend"], 30_000);
  socket.terminate();
  assert.deepEqual(await startedSandboxes(lifecycle.baseline), orphans, "a killed backend leaves its sandbox behind");

  await lifecycle.compose(["up", "-d", "--no-deps", "--force-recreate", "unosim-backend"], 180_000);
  await waitForGateway(lifecycle.gateway);
  await waitFor("orphan removal by the redeployed backend", async () => (await startedSandboxes(lifecycle.baseline)).length === 0, 30_000);
  assert.equal((await sandboxIds(foreignOwner)).length, 1, "the sweep must not touch another deployment's sandbox");
}

/** Graceful shutdown with several running simulations leaves no own sandbox. */
async function verifyGracefulShutdownWithActiveSimulations(lifecycle: Lifecycle, sockets: WebSocket[]): Promise<string> {
  for (let index = 0; index < 3; index += 1) sockets.push(await startRunningSimulation(lifecycle));
  assert.equal((await startedSandboxes(lifecycle.baseline)).length, 3, "three simulations must run before shutdown");
  assert.equal((await sandboxIds(lifecycle.owner)).length, 3, "every sandbox must carry the deployment owner label");

  // Stop only the backend: stopping the gateway first would close the
  // WebSockets and release the runners before the backend's shutdown path.
  console.log("[deployment] stopping the backend with three running simulations");
  const backendId = (await lifecycle.compose(["ps", "-q", "unosim-backend"], 20_000)).stdout.trim();
  const startedAt = Date.now();
  await checked("docker", ["stop", "-t", "15", backendId], { timeoutMs: 30_000 });
  const durationMs = Date.now() - startedAt;
  console.log(`[deployment] backend shutdown with three simulations took ${durationMs}ms`);
  await waitFor("gateway WebSocket close during shutdown", async () => sockets.every((open) => open.readyState === WebSocket.CLOSED), 5_000);
  const logs = (await lifecycle.compose(["logs", "--no-color", "unosim-backend"], 20_000)).stdout;
  assert.match(logs, /Graceful shutdown complete/);
  assert.doesNotMatch(logs, /Force shutdown after 10s timeout/);
  assert.deepEqual(await startedSandboxes(lifecycle.baseline), [], "graceful shutdown must remove every own sandbox");
  assert.ok(durationMs < 15_000, `shutdown took ${durationMs}ms`);
  return logs;
}

/** Fails diagnostically: the backend log explains most deployment failures. */
async function printBackendLogTail(projectName: string, env: NodeJS.ProcessEnv): Promise<void> {
  const logs = await runCommand("docker", [
    "compose", "-p", projectName, "-f", composeFile, "logs", "--no-color", "--tail", "150", "unosim-backend",
  ], { env, timeoutMs: 30_000 });
  console.error(`[deployment] backend log tail:\n${logs.stdout}${logs.stderr}`);
}

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

async function removeForeignSandbox(owner: string): Promise<void> {
  const foreign = await sandboxIds(owner).catch(() => []);
  if (foreign.length > 0) await runCommand("docker", ["rm", "-f", ...foreign], { timeoutMs: 20_000 });
}

/** Stops the stack and removes everything the run created; returns the first cleanup failure. */
async function teardown(run: {
  projectName: string;
  env: NodeJS.ProcessEnv;
  sockets: Array<WebSocket | undefined>;
  foreignOwner: string;
  stackStarted: boolean;
  baselineContainers: Set<string>;
  images: Awaited<ReturnType<typeof prepareImages>> | undefined;
  tempRoot: string;
}): Promise<Error | undefined> {
  let cleanupError: Error | undefined;
  for (const open of run.sockets) open?.terminate();
  await removeForeignSandbox(run.foreignOwner);
  if (run.stackStarted) {
    try {
      await compose(run.projectName, run.env, ["down", "--remove-orphans", "-v"], 60_000);
    } catch (error) {
      cleanupError = toError(error);
    }
  }
  try {
    const leaked = await removeLeakedSandboxes(run.baselineContainers);
    if (leaked.length > 0) {
      cleanupError ??= new Error(`deployment test left sandbox containers: ${leaked.join(", ")}`);
    }
  } catch (error) {
    cleanupError ??= toError(error);
  }
  if (run.images) {
    // Files written by the container user may not be removable by the runner user.
    await runCommand("docker", [
      "run", "--rm", "--user", "0", "-v", `${run.tempRoot}:/cleanup`, "--entrypoint", "sh", run.images.server,
      "-c", "rm -rf /cleanup/shared-temp",
    ], { timeoutMs: 60_000 });
  }
  await rm(run.tempRoot, { recursive: true, force: true });
  return cleanupError;
}

/** Frontend, authenticated API, tutor credential contract, identity headers and backend isolation. */
async function verifyGatewayContract(
  gateway: { port: number; ca: Buffer },
  composeCall: (args: string[], timeoutMs?: number) => Promise<CommandResult>,
): Promise<void> {
  const staticResponse = await httpsRequest(gateway, "/");
  assert.equal(staticResponse.statusCode, 200, "gateway must serve the production frontend");
  assert.match(staticResponse.body, /<div id=["']root["']/i, "production frontend root is missing");

  const statusResponse = await httpsRequest(gateway, "/api/status");
  assert.equal(statusResponse.statusCode, 200, "authenticated status request through gateway must succeed");
  const initialStatus = parseJson(statusResponse.body);
  assert.equal(initialStatus.serverMode, "docker");
  assert.equal(initialStatus.sandboxRunners.max, 3);
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
  await composeCall(["exec", "-T", "unosim-backend", "node", "-e", "process.exit(process.env.UNOSIM_DOCKER_TEST_BYPASS_GATEWAY === undefined ? 0 : 1)"], 20_000);
  await composeCall(["exec", "-T", "unosim-backend", "node", "-e", "process.exit(process.env.UNOSIM_TUTOR_MODE === undefined && process.env.UNOSIM_LLM_API_KEY === undefined ? 0 : 1)"], 20_000);

  const spoofedResponse = await httpsRequest(gateway, "/api/status", {
    headers: {
      "X-UnoSim-Gateway-Secret": "attacker-secret",
      "X-UnoSim-Subject": "attacker",
      "X-UnoSim-Roles": "user",
    },
  });
  assert.equal(spoofedResponse.statusCode, 200, "gateway must overwrite spoofed identity headers");

  const backendId = (await composeCall(["ps", "-q", "unosim-backend"], 20_000)).stdout.trim();
  const portBindings = (await checked("docker", [
    "inspect", backendId, "--format", "{{json .HostConfig.PortBindings}}",
  ], { timeoutMs: 20_000 })).stdout.trim();
  assert.ok(
    portBindings === "{}" || portBindings === "null",
    `backend must not publish a host port (port bindings: ${portBindings})`,
  );
  const directResponse = await composeCall(["exec", "-T", "unosim-backend", "node", "-e", "fetch('http://127.0.0.1:3000/api/status').then((r) => process.exit(r.status === 401 || r.status === 403 ? 0 : 1))"], 20_000);
  assert.equal(directResponse.code, 0, "direct backend access without gateway credentials must be rejected");
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
  const instanceId = `deployment-test-${runId}`;
  const foreignOwner = `instance.foreign-${runId}`;
  const dockerGid = await resolveDockerGid();
  const baselineContainers = await listContainerNames();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    DEPLOYMENT_GATEWAY_PORT: String(port),
    DEPLOYMENT_GATEWAY_ORIGIN: gatewayOrigin,
    DEPLOYMENT_GATEWAY_SECRET: gatewaySecret,
    DEPLOYMENT_INSTANCE_ID: instanceId,
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
  const sockets: WebSocket[] = [];
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
    await verifyGatewayContract(gateway, (args, timeoutMs) => compose(projectName, env, args, timeoutMs));

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

    socket.terminate();
    const lifecycle = { compose: (args: string[], timeoutMs?: number) => compose(projectName, env, args, timeoutMs), baseline: baselineContainers, gateway, origin: gatewayOrigin, owner: `instance.${instanceId}` };
    await verifyCrashRedeploySweep(lifecycle, images.sandbox, foreignOwner);
    backendLogs = await verifyGracefulShutdownWithActiveSimulations(lifecycle, sockets);
  } catch (error) {
    if (stackStarted) await printBackendLogTail(projectName, env);
    throw error;
  } finally {
    cleanupError = await teardown({ projectName, env, sockets: [socket, ...sockets], foreignOwner, stackStarted, baselineContainers, images, tempRoot });
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

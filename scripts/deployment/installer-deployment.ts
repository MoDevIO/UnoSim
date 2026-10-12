import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  assertPortFree,
  blinkSketch,
  checked,
  type CommandResult,
  createTestCertificate,
  expectRejectedOrigin,
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
  waitFor,
} from "./deployment-support";

/**
 * Ubuntu/VBox installer topology, verified end to end:
 *
 *   client --HTTPS--> Nginx (host network, installer-rendered site)
 *          --HTTP--> 127.0.0.1:3000 (published by the production
 *                    docker-compose.yml) --> backend container
 *
 * The backend runs from the unmodified production compose file with the .env
 * the installer renders, so the trusted proxy, the Compose network, the origins
 * and the gateway headers are exactly the installer's. Only images, the
 * container name and an unreachable tutor provider URL are overridden.
 *
 * DEPLOYMENT_TRUSTED_PROXY_OVERRIDE replaces the rendered trusted proxy, e.g.
 * 127.0.0.1/32 to reproduce the former installer value (the test then fails).
 */

const repoRoot = process.cwd();
const productionComposeFile = join(repoRoot, "docker-compose.yml");
const installerOverrideFile = join(repoRoot, "tests/deployment/docker-compose.installer.yml");
const renderer = join(repoRoot, "scripts/ubuntu-vbox-render.sh");
// A second loopback address stands in for the LAN address the installer gets.
const lanIp = "127.0.0.2";
const gatewayPort = 8443;
const gatewayOrigin = `https://127.0.0.1:${gatewayPort}`;
const testCredential = "deployment-test-credential";

type Env = Record<string, string>;

function parseDotEnv(content: string): Env {
  return Object.fromEntries(
    content.split("\n").filter((line) => line.includes("=")).map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
}

/** Process environment without host UnoSim settings that would shadow the .env. */
function isolatedProcessEnv(): Env {
  const env: Env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("UNOSIM_") || key === "DOCKER_GID") continue;
    env[key] = value;
  }
  return env;
}

async function assertSubnetUnused(subnet: string): Promise<void> {
  const ids = (await checked("docker", ["network", "ls", "-q"], { timeoutMs: 20_000 })).stdout.split("\n").filter(Boolean);
  if (ids.length === 0) return;
  const inspected = await checked("docker", [
    "network", "inspect", ...ids, "--format", "{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}",
  ], { timeoutMs: 20_000 });
  const clash = inspected.stdout.split("\n").find((line) => line.split(" ").includes(subnet));
  if (clash) throw new Error(`Docker network subnet ${subnet} is already in use: ${clash.trim()}`);
}

/** Tutor request from a container on the backend network, i.e. not through the trusted proxy. */
async function untrustedTutorRequest(network: string, image: string, env: Env): Promise<{ status: number; body: Record<string, any> }> {
  const script = `
    fetch("http://unosim-backend:3000/api/tutor/models", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.7",
        "x-unosim-gateway-secret": process.env.PROBE_SECRET,
        "x-unosim-subject": "probe",
        "x-unosim-roles": "user",
      },
      body: JSON.stringify({ credential: ${JSON.stringify(testCredential)} }),
    }).then(async (response) => {
      console.log(JSON.stringify({ status: response.status, body: await response.json() }));
    }).catch((error) => { console.error(String(error)); process.exit(2); });`;
  const result = await checked("docker", [
    "run", "--rm", "--network", network, "--env", "PROBE_SECRET", "--entrypoint", "node", image, "-e", script,
  ], { env: { ...env, PROBE_SECRET: env.UNOSIM_GATEWAY_SECRET }, timeoutMs: 60_000 });
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
}

/**
 * Capacity values an operator applies from a reviewed capacity.env proposal by
 * appending them to .env. Distinct from every default, so the assertions below
 * prove that Compose passes them to the backend.
 */
const appliedCapacityEnv: Env = {
  SIMULATION_MAX_CONCURRENT: "96",
  SIMULATION_QUEUE_TIMEOUT_MS: "151000",
};

const runtimeDirectories = ["server/arduino-cache", "temp", "storage"];
const prepareScript = join(repoRoot, "scripts/prepare-runtime-dirs.sh");

/**
 * Runs the production preparation script the installer calls through sudo. It
 * runs as root inside the server image, the way sudo runs it on a host, and
 * leaves the directories to the image's own user. The runner user that owns
 * projectDir is not that user (UID 1001 on GitHub runners), so this proves the
 * preparation does not depend on the host account's UID.
 */
async function prepareRuntimeDirectories(projectDir: string, serverImage: string): Promise<void> {
  const [uid, gid] = await Promise.all(["-u", "-g"].map(async (flag) => (await checked("docker", [
    "run", "--rm", "--entrypoint", "id", serverImage, flag,
  ], { timeoutMs: 60_000 })).stdout.trim()));
  const source = await readFile(prepareScript, "utf8");
  const defaults = `${/^RUNTIME_UID='(\d+)'$/m.exec(source)?.[1]}:${/^RUNTIME_GID='(\d+)'$/m.exec(source)?.[1]}`;
  assert.equal(defaults, `${uid}:${gid}`, "prepare-runtime-dirs.sh must default to the UID:GID of the image's user");

  await checked("docker", [
    "run", "--rm", "--user", "0",
    "-v", `${projectDir}:/project`,
    "-v", `${prepareScript}:/prepare-runtime-dirs.sh:ro`,
    "--entrypoint", "bash", serverImage, "/prepare-runtime-dirs.sh", "--project-dir", "/project",
  ], { timeoutMs: 60_000 });
}

/** The backend user must be able to write every bind-mounted runtime directory. */
async function assertRuntimeDirectoriesWritable(container: string): Promise<void> {
  const probe = await checked("docker", [
    "exec", container, "sh", "-c",
    'id -u; for d in "$ARDUINO_CACHE_DIR" "$UNOSIM_SHARED_TEMP_DIR" /app/storage; do ' +
      'f="$d/.deployment-write-probe"; touch "$f" && rm -f "$f" && echo "writable $d" || echo "NOT WRITABLE $d"; done',
  ], { timeoutMs: 30_000 });
  const lines = probe.stdout.trim().split("\n");
  assert.notEqual(lines[0], "0", "the backend must not run as root");
  assert.equal(lines.filter((line) => line.startsWith("writable ")).length, runtimeDirectories.length,
    `backend user cannot write all runtime directories:\n${probe.stdout}`);
}

/** Writes the installer-rendered .env, Nginx site, secret snippet and TLS files. */
async function renderInstallerProject(
  projectDir: string,
  nginxDir: string,
  tlsDir: string,
  serverImage: string,
): Promise<{ installerEnv: Env; ca: Buffer }> {
  // The installer creates these through prepare-runtime-dirs.sh; the checkout
  // owner and the container user differ, so a plain mkdir is not enough.
  await prepareRuntimeDirectories(projectDir, serverImage);
  await mkdir(tlsDir, { recursive: true });

  const gatewaySecret = (await checked("openssl", ["rand", "-hex", "32"])).stdout.trim();
  const renderedEnv = (await checked("bash", [
    renderer, "env", "--lan-ip", lanIp, "--docker-gid", await resolveDockerGid(),
  ], { input: `${gatewaySecret}\n` })).stdout;
  const override = process.env.DEPLOYMENT_TRUSTED_PROXY_OVERRIDE;
  const gatewayEnv = override
    ? renderedEnv.replace(/^UNOSIM_TRUSTED_PROXY=.*$/m, `UNOSIM_TRUSTED_PROXY=${override}`)
    : renderedEnv;
  const capacityLines = Object.entries(appliedCapacityEnv).map(([key, value]) => `${key}=${value}\n`).join("");
  const dotEnv = gatewayEnv + capacityLines;
  await writeFile(join(projectDir, ".env"), dotEnv, { mode: 0o600 });
  const installerEnv = parseDotEnv(dotEnv);
  await assertSubnetUnused(installerEnv.UNOSIM_DOCKER_SUBNET);

  await writeFile(join(nginxDir, "site.conf"), (await checked("bash", [renderer, "nginx-site", "--lan-ip", lanIp])).stdout);
  await writeFile(join(nginxDir, "secret.conf"), (await checked("bash", [renderer, "nginx-secret-snippet"], { input: `${gatewaySecret}\n` })).stdout);
  const ca = await createTestCertificate(tlsDir, { certificate: "unosim-lan.crt", key: "unosim-lan.key" });
  await chmod(join(tlsDir, "unosim-lan.key"), 0o644);

  return { installerEnv, ca };
}

/** Trusted and untrusted credential transport and gateway-owned identity headers. */
async function verifyTrustChain(
  gateway: { port: number; ca: Buffer },
  network: string,
  image: string,
  env: Env,
  installerEnv: Env,
): Promise<void> {
  // A. Trusted proxy: the host gateway's X-Forwarded-Proto counts, so a
  // personal credential passes the HTTPS transport check and reaches the
  // (deliberately unreachable) provider.
  const trusted = await httpsRequest(gateway, "/api/tutor/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential: testCredential }),
    timeoutMs: 60_000,
  });
  const trustedCode = parseJson(trusted.body).error?.code;
  assert.notEqual(trustedCode, "INVALID_REQUEST",
    `credential over the installer HTTPS gateway was rejected as insecure transport (trusted proxy ${installerEnv.UNOSIM_TRUSTED_PROXY}): ${trusted.body}`);
  assert.equal(trusted.statusCode, 502, `expected provider failure after transport check, got ${trusted.statusCode}: ${trusted.body}`);
  assert.equal(trustedCode, "PROVIDER_UNAVAILABLE");

  // B. Untrusted peer with a forged X-Forwarded-Proto and a valid gateway
  // identity: not the trusted proxy, so the credential must be refused.
  const untrusted = await untrustedTutorRequest(network, image, env);
  assert.equal(untrusted.status, 400, `forged X-Forwarded-Proto from an untrusted peer returned ${untrusted.status}`);
  assert.equal(untrusted.body.error?.code, "INVALID_REQUEST");
  assert.match(String(untrusted.body.error?.message), /HTTPS/);

  // C. Gateway headers: client-supplied identity headers have no effect.
  const spoofed = await httpsRequest(gateway, "/api/status", {
    headers: {
      "X-UnoSim-Gateway-Secret": "attacker-secret",
      "X-UnoSim-Subject": "attacker",
      "X-UnoSim-Roles": "admin",
    },
  });
  assert.equal(spoofed.statusCode, 200, "gateway must overwrite spoofed identity headers");

  // D. The installer's measured admission limit reaches the backend unchanged through Compose.
  const admissionMax = (JSON.parse(spoofed.body) as { capacity?: { admission?: { max?: number } } }).capacity?.admission?.max;
  assert.equal(admissionMax, Number(installerEnv.SIMULATION_ADMISSION_MAX),
    `backend admission limit ${admissionMax} does not match the installer value ${installerEnv.SIMULATION_ADMISSION_MAX}`);

  // E. Capacity values applied through .env reach the backend: Compose used to
  // ignore SIMULATION_QUEUE_TIMEOUT_MS and pin SIMULATION_MAX_CONCURRENT to 200.
  const capacity = (JSON.parse(spoofed.body) as {
    capacity?: { queue?: { timeoutMs?: number }; simulation?: { maxConcurrent?: number } };
  }).capacity;
  assert.equal(capacity?.queue?.timeoutMs, Number(appliedCapacityEnv.SIMULATION_QUEUE_TIMEOUT_MS),
    `backend queue timeout ${capacity?.queue?.timeoutMs} does not match .env SIMULATION_QUEUE_TIMEOUT_MS`);
  assert.equal(capacity?.simulation?.maxConcurrent, Number(appliedCapacityEnv.SIMULATION_MAX_CONCURRENT),
    `backend simulation limit ${capacity?.simulation?.maxConcurrent} does not match .env SIMULATION_MAX_CONCURRENT`);
}

/** Installer origins, WebSocket and a sandboxed simulation through the gateway. */
async function verifyWebSocketAndSimulation(
  gateway: { port: number; ca: Buffer },
  installerEnv: Env,
  baselineContainers: Set<string>,
  sockets: WebSocket[],
): Promise<void> {
  // D. Production origins and WebSocket through the installer gateway.
  const allowedOrigins = installerEnv.UNOSIM_ALLOWED_WS_ORIGINS.split(",");
  assert.ok(allowedOrigins.includes(gatewayOrigin), `${gatewayOrigin} must be an installer origin`);
  await expectRejectedOrigin(gateway);
  await expectRejectedOrigin(gateway, "https://127.0.0.1:9443");
  const socket = await openWebSocket(gateway, gatewayOrigin, { "X-UnoSim-Subject": "attacker" });
  sockets.push(socket);
  await nextWebSocketMessage(socket, (message) => message.type === "simulation_status" && message.status === "stopped");

  const compiled = await httpsRequest(gateway, "/api/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: blinkSketch }),
    timeoutMs: 180_000,
  });
  assert.equal(compiled.statusCode, 200, `compile through installer gateway returned ${compiled.statusCode}: ${compiled.body}`);
  assert.equal(parseJson(compiled.body).success, true, "compile through installer gateway must succeed");

  socket.send(JSON.stringify({ type: "start_simulation", code: blinkSketch }));
  await nextWebSocketMessage(socket, (message) => message.type === "simulation_status" && message.status === "running", 180_000);
  const running = [...await listContainerNames()].filter((name) => name.startsWith("unosim-sandbox-") && !baselineContainers.has(name));
  assert.ok(running.length > 0, "simulation must run in a Docker sandbox started through the installer compose setup");
  socket.send(JSON.stringify({ type: "stop_simulation" }));
  await nextWebSocketMessage(socket, (message) => message.type === "simulation_status" && message.status === "stopped", 60_000);
  await waitFor("sandbox runner release", async () => {
    const status = parseJson((await httpsRequest(gateway, "/api/status")).body);
    return status.sandboxRunners.inUse === 0 && status.webSocketSessions.running === 0;
  }, 60_000);

}

/** Stops the stack and removes everything the run created; returns the first cleanup failure. */
async function teardown(run: {
  sockets: WebSocket[];
  stackStarted: boolean;
  compose: (args: string[], timeoutMs?: number) => Promise<CommandResult>;
  baselineContainers: Set<string>;
  images: Awaited<ReturnType<typeof prepareImages>> | undefined;
  projectDir: string;
}): Promise<Error | undefined> {
  const { sockets, stackStarted, compose, baselineContainers, images, projectDir } = run;
  let cleanupError: Error | undefined;
  for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  if (stackStarted) {
    try {
      await compose(["down", "--remove-orphans", "-v"], 90_000);
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    }
  }
  try {
    const leaked = await removeLeakedSandboxes(baselineContainers);
    if (leaked.length > 0) cleanupError ??= new Error(`installer test left sandbox containers: ${leaked.join(", ")}`);
  } catch (error) {
    cleanupError ??= error instanceof Error ? error : new Error(String(error));
  }
  if (images) {
    // Files written by the container user may not be removable by the runner user.
    await runCommand("docker", [
      "run", "--rm", "--user", "0", "-v", `${projectDir}:/cleanup`, "--entrypoint", "sh", images.server,
      "-c", "rm -rf /cleanup/temp /cleanup/server /cleanup/storage",
    ], { timeoutMs: 60_000 });
  }
  await rm(projectDir, { recursive: true, force: true });

  return cleanupError;
}

/** The production compose file must mount the installer's runtime directories. */
async function assertRuntimeMounts(container: string, projectDir: string): Promise<void> {
  const mounts = (await checked("docker", [
    "inspect", container, "--format", "{{range .Mounts}}{{.Source}}\n{{end}}",
  ], { timeoutMs: 20_000 })).stdout.split("\n").filter(Boolean);
  for (const directory of runtimeDirectories) {
    assert.ok(mounts.includes(join(projectDir, directory)), `backend must mount ${join(projectDir, directory)} (mounts: ${mounts.join(", ")})`);
  }
}

/** Fails diagnostically: the backend log explains most deployment failures. */
async function printBackendLogTail(container: string): Promise<void> {
  const logs = await runCommand("docker", ["logs", "--tail", "200", container], { timeoutMs: 30_000 });
  console.error(`[installer-deployment] backend log tail:\n${logs.stdout}${logs.stderr}`);
  // Writable runtime paths of the production compose file, seen by the backend user.
  const probe = await runCommand("docker", [
    "exec", container, "sh", "-c",
    'id; for d in "$ARDUINO_CACHE_DIR" "$UNOSIM_SHARED_TEMP_DIR" /app/storage; do ls -ld "$d"; touch "$d/.write-probe" && echo "writable $d" && rm -f "$d/.write-probe"; done; ls -la /app/storage "$UNOSIM_SHARED_TEMP_DIR"',
  ], { timeoutMs: 30_000 });
  console.error(`[installer-deployment] backend filesystem probe:\n${probe.stdout}${probe.stderr}`);
}

async function main(): Promise<void> {
  const runId = `${Date.now()}-${process.pid}`;
  const projectName = `unosim-installer-test-${process.pid}`;
  const backendContainer = `unosim-installer-backend-${process.pid}`;
  const projectDir = await mkdtemp(join(tmpdir(), "unosim-installer-"));
  const nginxDir = join(projectDir, "nginx");
  const tlsDir = join(nginxDir, "tls");
  const baselineContainers = await listContainerNames();
  let images: Awaited<ReturnType<typeof prepareImages>> | undefined;
  let composeEnv: Env = {};
  let stackStarted = false;
  const sockets: WebSocket[] = [];
  let cleanupError: Error | undefined;

  // Like the installer (cd + PWD): Compose may take ${PWD} from the working directory.
  const compose = (args: string[], timeoutMs = 120_000): Promise<CommandResult> => checked("docker", [
    "compose", "-p", projectName, "--project-directory", projectDir,
    "-f", productionComposeFile, "-f", installerOverrideFile, ...args,
  ], { cwd: projectDir, env: composeEnv, timeoutMs });

  try {
    for (const port of [3000, 443, gatewayPort]) await assertPortFree(port);
    images = await prepareImages(runId);

    const { installerEnv, ca } = await renderInstallerProject(projectDir, nginxDir, tlsDir, images.server);
    const gateway = { port: gatewayPort, ca };

    composeEnv = {
      ...isolatedProcessEnv(),
      // The installer runs Compose with PWD set to the checkout.
      PWD: projectDir,
      UNOSIM_EXAMPLES_SOURCE: "",
      UNOSIM_EXAMPLES_REF: "",
      DEPLOYMENT_SERVER_IMAGE: images.server,
      DEPLOYMENT_SANDBOX_IMAGE: images.sandbox,
      DEPLOYMENT_BACKEND_CONTAINER: backendContainer,
      DEPLOYMENT_INSTANCE_ID: `installer-test-${runId}`,
      DEPLOYMENT_NGINX_SITE: join(nginxDir, "site.conf"),
      DEPLOYMENT_NGINX_SECRET_SNIPPET: join(nginxDir, "secret.conf"),
      DEPLOYMENT_TLS_DIR: tlsDir,
    };

    console.log(`[installer-deployment] starting ${projectName} (trusted proxy ${installerEnv.UNOSIM_TRUSTED_PROXY})`);
    stackStarted = true;
    await compose(["up", "-d", "--no-build"], 240_000);

    await assertRuntimeMounts(backendContainer, projectDir);
    await assertRuntimeDirectoriesWritable(backendContainer);
    const network = `${projectName}_default`;
    const networkGateway = (await checked("docker", [
      "network", "inspect", network, "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}",
    ], { timeoutMs: 20_000 })).stdout.trim();
    assert.equal(networkGateway, installerEnv.UNOSIM_DOCKER_GATEWAY, "Compose network must use the installer gateway");

    await waitFor("installer gateway readiness", async () => {
      const response = await httpsRequest(gateway, "/api/readiness", { timeoutMs: 5_000 });
      return response.statusCode === 200;
    }, 180_000);
    const standardPort = await httpsRequest({ port: 443, ca }, "/api/readiness");
    assert.equal(standardPort.statusCode, 200, "installer site must also serve HTTPS on port 443");

    await verifyTrustChain(gateway, network, images.server, { ...composeEnv, ...installerEnv }, installerEnv);

    await verifyWebSocketAndSimulation(gateway, installerEnv, baselineContainers, sockets);

    const logs = (await compose(["logs", "--no-color", "unosim-backend"], 30_000)).stdout;
    assert.match(logs, /Trust Mode:\s+gateway/);
    assert.match(logs, /for subject ip-[0-9a-f.:]+/, "subject must come from the gateway's observed client address");
    assert.doesNotMatch(logs, /subject attacker/, "client-supplied subject must not reach the backend");
    console.log("[installer-deployment] trust chain, gateway headers, origins and simulation verified");
  } catch (error) {
    if (stackStarted) await printBackendLogTail(backendContainer);
    throw error;
  } finally {
    cleanupError = await teardown({ sockets, stackStarted, compose, baselineContainers, images, projectDir });
  }

  if (cleanupError) throw cleanupError;
  console.log("[installer-deployment] Ubuntu/VBox installer topology test passed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAsScript(main, "installer-deployment");
}


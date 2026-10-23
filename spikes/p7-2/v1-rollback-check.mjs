// One-time check for plan 9.3 / P7.2: V2 -> V1 -> V2 on the same .env and storage/.
// Usage (from the repository root, both sandbox images built): node spikes/p7-2/v1-rollback-check.mjs <v2-image> <v1-image>
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(join(process.cwd(), "package.json"));
const WebSocket = require("ws");
const [v2, v1] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "unosim-rollback-"));
const temp = join(root, "temp");
const storage = join(root, "storage");
for (const dir of [temp, storage]) { execFileSync("mkdir", ["-p", dir]); chmodSync(dir, 0o777); }
const port = 3917;
const name = "unosim-rollback-check";
// The .env of a V2 pilot instance, as Compose passes it (empty entries included).
const env = {
  NODE_ENV: "test", UNOSIM_SERVER_MODE: "docker", UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1",
  UNOSIM_INSTANCE_ID: "rollback-check", UNOSIM_LISTEN_HOST: "0.0.0.0", UNOSIM_UNSAFE_ALLOW_EXTERNAL_LOCAL_BIND: "true", UNOSIM_SHARED_TEMP_DIR: temp, ARDUINO_CACHE_DIR: "/app/server/arduino-cache",
  DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_SANDBOX_IMAGE: "unosim-sandbox:latest",
  COMPILE_SANDBOX_IMAGE: "unosim-compile-sandbox:latest", COMPILE_SANDBOX_MEMORY_MB: "512", COMPILE_SANDBOX_CPU_LIMIT: "1", COMPILE_SANDBOX_PIDS_LIMIT: "128",
  UNOSIM_RUNTIME_BACKENDS: "browser,host-mock", UNOSIM_DEFAULT_RUNTIME: "browser", UNOSIM_BOARDS: "", UNOSIM_DEFAULT_BOARD: "",
  UNOSIM_EXAMPLES_SOURCE: "", UNOSIM_EXAMPLES_REF: "", SIMULATION_MAX_CONCURRENT: "3", SANDBOX_MEMORY_MB: "256", SANDBOX_CPU_LIMIT: "0.5",
};
const envFile = join(root, "env");
writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
const blink = "void setup(){ Serial.begin(9600); pinMode(13, OUTPUT); }\nvoid loop(){ digitalWrite(13, !digitalRead(13)); Serial.println(millis()); delay(200); }\n";

function up(image) {
  spawnSync("docker", ["rm", "-f", name]);
  execFileSync("docker", ["run", "-d", "--name", name, "--env-file", envFile, "--group-add", "0",
    "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", `${temp}:${temp}`, "-v", `${storage}:/app/storage`,
    "-p", `127.0.0.1:${port}:3000`, image]);
}
async function ready() {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/readiness`)).status === 200) return; } catch {}
    const state = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" }).stdout.trim();
    if (state === "false") throw new Error(`backend exited:\n${spawnSync("docker", ["logs", "--tail", "30", name], { encoding: "utf8" }).stderr}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`not ready:\n${spawnSync("docker", ["logs", "--tail", "15", name], { encoding: "utf8" }).stdout}${spawnSync("docker", ["logs", "--tail", "15", name], { encoding: "utf8" }).stderr}`);
}
async function compile(code, board) {
  const response = await fetch(`http://127.0.0.1:${port}/api/compile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, ...(board ? { board } : {}) }) });
  const body = await response.json();
  return { status: response.status, success: body.success, artifact: body.artifact ? body.artifact.board : null, output: (body.output ?? "").split("\n")[0], error: body.stderr ?? body.error };
}
async function simulate(code) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 60_000);
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "serial_output") { clearTimeout(timer); resolve(`serial output: ${String(message.data).trim().slice(0, 20)}`); }
    });
    socket.send(JSON.stringify({ type: "start_simulation", code }));
  });
  socket.send(JSON.stringify({ type: "stop_simulation" }));
  socket.close();
  return outcome;
}
const cacheFiles = () => readdirSync(join(storage, "cache", "hex-cache")).map((f) => f.replace(/^[0-9a-f]{16,}/, "<hash>")).sort();

const report = [];
try {
  up(v2); await ready();
  report.push(["V2", "readiness", "200"]);
  report.push(["V2", "compile uno", JSON.stringify(await compile(blink))]);
  report.push(["V2", "compile nano", JSON.stringify(await compile(blink, "nano"))]);
  report.push(["V2", "host-mock run", await simulate(blink)]);
  report.push(["V2", "hex-cache", JSON.stringify([...new Set(cacheFiles())])]);
  execFileSync("docker", ["stop", "-t", "15", name]);

  up(v1); await ready();
  report.push(["V1", "readiness (same .env, same storage)", "200"]);
  report.push(["V1", "compile uno (V2 cache entry)", JSON.stringify(await compile(blink))]);
  report.push(["V1", "compile uno (new sketch)", JSON.stringify(await compile(blink.replace("200", "300")))]);
  report.push(["V1", "host-mock run", await simulate(blink)]);
  execFileSync("docker", ["stop", "-t", "15", name]);

  up(v2); await ready();
  report.push(["V2 again", "compile uno (entry V1 wrote)", JSON.stringify(await compile(blink.replace("200", "300")))]);
  report.push(["V2 again", "compile uno (V2 entry)", JSON.stringify(await compile(blink))]);
} catch (error) {
  report.push(["FAILED", "", String(error.message ?? error)]);
} finally {
  spawnSync("docker", ["rm", "-f", name]);
  const leftovers = spawnSync("docker", ["ps", "-aq", "--filter", "label=unosim.owner=instance.rollback-check"], { encoding: "utf8" }).stdout.trim();
  report.push(["cleanup", "containers left", leftovers || "none"]);
  for (const row of report) console.log(row.join(" | "));
}

import { spawn } from "node:child_process";

const removedRuntimeSelectors = [
  "UNOSIM_SIMULATION_MODE",
  "UNOSIM_TRUST_MODE",
  "FORCE_DOCKER",
  "UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL",
  "UNOSIM_DOCKER_TEST_BYPASS_GATEWAY",
];

function readNodeEnv(argv) {
  const option = argv.find((value) => value.startsWith("--node-env="));
  const nodeEnv = option?.slice("--node-env=".length) ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    throw new Error(`Unsupported local development NODE_ENV: ${nodeEnv}`);
  }
  return nodeEnv;
}

export function prepareLocalDevelopmentEnv(sourceEnv = process.env, nodeEnv = "development") {
  const env = { ...sourceEnv, NODE_ENV: nodeEnv, UNOSIM_SERVER_MODE: "local" };
  for (const key of removedRuntimeSelectors) delete env[key];
  return env;
}

const nodeEnv = readNodeEnv(process.argv.slice(2));
const tsxCommand = process.platform === "win32" ? "tsx.cmd" : "tsx";
const child = spawn(tsxCommand, ["server/index.ts", "--host"], {
  cwd: process.cwd(),
  env: prepareLocalDevelopmentEnv(process.env, nodeEnv),
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(`[local-dev] Failed to start server: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

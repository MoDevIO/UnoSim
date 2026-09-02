import { spawn } from "node:child_process";

async function collectSandboxContainerIds(): Promise<string[]> {
  return new Promise((resolve) => {
    const process = spawn("docker", [
      "ps",
      "-aq",
      "--filter",
      "name=unosim-sandbox-",
    ]);
    let output = "";
    process.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    process.on("error", () => resolve([]));
    process.on("close", () => resolve(output.split("\n").filter(Boolean)));
  });
}

async function removeSandboxContainers(): Promise<void> {
  try {
    const containerIds = await collectSandboxContainerIds();
    if (containerIds.length === 0) return;
    await new Promise<void>((resolve) => {
      const process = spawn("docker", ["rm", "-f", ...containerIds]);
      process.on("error", () => resolve());
      process.on("close", () => resolve());
    });
  } catch {
    // Docker may become unavailable during teardown; never mask test failures.
  }
}

export function setup(): () => Promise<void> {
  return removeSandboxContainers;
}

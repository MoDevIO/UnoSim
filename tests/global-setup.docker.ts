import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { SANDBOX_OWNER_LABEL } from "../server/services/sandbox/orphan-sweep";

function docker(args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    const process = spawn("docker", args); // NOSONAR S4036 - the Docker CLI of the test machine
    let output = "";
    process.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    process.on("error", () => resolve(""));
    process.on("close", () => resolve(output));
  });
}

/**
 * Gives this test run its own sandbox owner: the workers inherit UNOSIM_INSTANCE_ID, so every sandbox and
 * compile container of the run carries `unosim.owner=instance.<id>`. The teardown removes exactly those, never
 * the containers of a development server or of another test run on the same Docker daemon.
 */
export function setup(): () => Promise<void> {
  const instanceId = `vitest-${randomUUID().slice(0, 8)}`;
  process.env.UNOSIM_INSTANCE_ID = instanceId;
  const owner = `instance.${instanceId}`;
  return async () => {
    try {
      const ids = (await docker(["ps", "-aq", "--filter", `label=${SANDBOX_OWNER_LABEL}=${owner}`])).split("\n").filter(Boolean);
      if (ids.length > 0) await docker(["rm", "-f", ...ids]);
    } catch {
      // Docker may become unavailable during teardown; never mask test failures.
    }
  };
}

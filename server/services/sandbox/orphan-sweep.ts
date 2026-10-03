import { hostname } from "node:os";
import type { ProcessExecution } from "../process-execution-port";

/**
 * Every sandbox container carries the identity of the backend process that
 * started it. In the Docker deployment the backend is PID 1 of a container
 * with a stable hostname, so a restarted backend (e.g. after an uncaught
 * exception) has the same owner and can remove what its previous incarnation
 * left running. Other UnoSim backends on the same Docker host – deployment
 * checks, capacity runs, parallel test processes – have a different owner and
 * are never touched.
 */
export const SANDBOX_OWNER_LABEL = "unosim.owner";

export function sandboxOwner(host: string = hostname(), pid: number = process.pid): string {
  return `${host.replaceAll(/[^A-Za-z0-9._-]+/g, "-")}:${pid}`;
}

type SweepLogger = {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
};

/**
 * Removes the sandbox containers of an earlier incarnation of this backend.
 * Called once at startup, before this process starts any sandbox, so every
 * container with its owner label is an orphan. Never throws.
 */
export async function removeOrphanedSandboxContainers(
  executor: ProcessExecution,
  owner: string,
  logger: SweepLogger,
): Promise<number> {
  try {
    const listed = await executor.execute(
      "docker",
      ["ps", "-aq", "--filter", `label=${SANDBOX_OWNER_LABEL}=${owner}`],
      { timeout: 10_000, stdio: "pipe" },
    );
    const ids = (listed.stdout ?? "").split(/\s+/).filter(Boolean);
    let removed = 0;
    for (const id of ids) {
      const result = await executor.execute("docker", ["rm", "-f", id], { timeout: 10_000, stdio: "pipe" });
      if (result.code === 0) removed += 1;
      else logger.warn(`Could not remove orphaned sandbox container ${id} (exit ${result.code})`);
    }
    if (removed > 0) logger.info(`Removed ${removed} orphaned sandbox container(s) of ${owner}`);
    return removed;
  } catch (error) {
    logger.warn(`Orphaned sandbox sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

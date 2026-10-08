import { hostname } from "node:os";
import { config } from "../../config";
import type { ProcessExecution } from "../process-execution-port";

/**
 * Every sandbox container carries the identity of the backend that started it.
 *
 * With UNOSIM_INSTANCE_ID the owner is the deployment, not the process: a
 * restarted or redeployed backend (new container hostname, same deployment)
 * removes what its predecessor left running. Without it, ownership is host and
 * PID, which keeps parallel test processes and local runs apart. Backends of
 * other deployments – deployment checks, capacity runs – carry another owner
 * and are never touched. Concurrently running backends must not share an ID.
 */
export const SANDBOX_OWNER_LABEL = "unosim.owner";

export function sandboxOwner(
  host: string = hostname(),
  pid: number = process.pid,
  instanceId: string | undefined = config.sandbox.instanceId,
): string {
  // A host:pid owner always contains ':', an instance owner never does.
  if (instanceId) return `instance.${instanceId}`;
  return `${host.replaceAll(/[^A-Za-z0-9._-]+/g, "-")}:${pid}`;
}

type SweepLogger = {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
};

/**
 * Removes every sandbox container that carries the given owner label. Runs at
 * startup, before this process starts any sandbox, so each match is an orphan
 * of an earlier incarnation, and at the end of a graceful shutdown. Every
 * container is attempted even if others fail; a container that disappeared
 * meanwhile counts as removed, so repeated sweeps are idempotent. Never throws.
 */
export async function removeOrphanedSandboxContainers(
  executor: ProcessExecution,
  owner: string,
  logger: SweepLogger,
  timeoutMs = 10_000,
): Promise<number> {
  let ids: string[];
  try {
    const listed = await executor.execute(
      "docker",
      ["ps", "-aq", "--filter", `label=${SANDBOX_OWNER_LABEL}=${owner}`],
      { timeout: timeoutMs, stdio: "pipe" },
    );
    if (listed.code !== 0 || listed.error) {
      logger.warn(`Orphaned sandbox sweep could not list containers of ${owner} (exit ${listed.code})`);
      return 0;
    }
    ids = (listed.stdout ?? "").split(/\s+/).filter(Boolean);
  } catch (error) {
    logger.warn(`Orphaned sandbox sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }

  const results = await Promise.all(ids.map((id) => removeContainer(executor, id, timeoutMs, logger)));
  const removed = results.filter(Boolean).length;
  if (removed > 0) logger.info(`Removed ${removed} orphaned sandbox container(s) of ${owner}`);
  if (removed < ids.length) {
    logger.warn(`${ids.length - removed} orphaned sandbox container(s) of ${owner} could not be removed`);
  }
  return removed;
}

async function removeContainer(
  executor: ProcessExecution,
  id: string,
  timeoutMs: number,
  logger: SweepLogger,
): Promise<boolean> {
  try {
    const result = await executor.execute("docker", ["rm", "-f", id], { timeout: timeoutMs, stdio: "pipe" });
    if (result.code === 0) return true;
    // `--rm` containers may vanish between listing and removal.
    if (/no such container/i.test(result.stderr ?? "")) return true;
    logger.warn(`Could not remove orphaned sandbox container ${id} (exit ${result.code})`);
    return false;
  } catch (error) {
    logger.warn(`Could not remove orphaned sandbox container ${id}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

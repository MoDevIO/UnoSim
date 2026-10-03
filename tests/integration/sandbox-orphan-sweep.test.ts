import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { ProcessExecutor } from "../../server/services/process-executor";
import { removeOrphanedSandboxContainers, SANDBOX_OWNER_LABEL } from "../../server/services/sandbox/orphan-sweep";

const run = promisify(execFile);
const IMAGE = process.env.DOCKER_SANDBOX_IMAGE ?? "unosim-sandbox:latest";
const created: string[] = [];

async function startLabelled(owner: string): Promise<string> {
  const { stdout } = await run("docker", ["run", "-d", "--rm", "--label", `${SANDBOX_OWNER_LABEL}=${owner}`, "--entrypoint", "sleep", IMAGE, "120"]);
  const id = stdout.trim();
  created.push(id);
  return id;
}

async function exists(id: string): Promise<boolean> {
  const { stdout } = await run("docker", ["ps", "-aq", "--no-trunc", "--filter", `id=${id}`]);
  return stdout.trim().length > 0;
}

afterAll(async () => {
  await Promise.all(created.map((id) => run("docker", ["rm", "-f", id]).catch(() => undefined)));
});

describe("orphaned sandbox sweep (real Docker)", () => {
  it("removes only containers of the given owner", async () => {
    const owner = `orphan-test-${randomUUID().slice(0, 8)}:1`;
    const foreignOwner = `orphan-test-${randomUUID().slice(0, 8)}:2`;
    const orphan = await startLabelled(owner);
    const foreign = await startLabelled(foreignOwner);

    const removed = await removeOrphanedSandboxContainers(new ProcessExecutor(), owner, { info() {}, warn() {}, debug() {} });

    expect(removed).toBe(1);
    expect(await exists(orphan)).toBe(false);
    expect(await exists(foreign)).toBe(true);
  }, 60_000);
});

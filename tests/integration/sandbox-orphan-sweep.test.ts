import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { ProcessExecutor } from "../../server/services/process-executor";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerCommandBuilder } from "../../server/services/docker-command-builder";
import { removeOrphanedSandboxContainers, SANDBOX_OWNER_LABEL, sandboxOwner } from "../../server/services/sandbox/orphan-sweep";

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

  it("lets a redeployed backend remove its predecessor's sandboxes, never another deployment's, idempotently", async () => {
    const deployment = `orphan-test-${randomUUID().slice(0, 8)}`;
    // Same deployment, different container hostname: the redeploy case.
    const previousBackend = sandboxOwner("3f2a9c1d0b7e", 1, deployment);
    const redeployedBackend = sandboxOwner("9e8d7c6b5a4f", 1, deployment);
    const foreignDeployment = sandboxOwner("3f2a9c1d0b7e", 1, `${deployment}-foreign`);
    const orphans = [await startLabelled(previousBackend), await startLabelled(previousBackend)];
    const foreign = await startLabelled(foreignDeployment);
    const silent = { info() {}, warn() {}, debug() {} };

    expect(await removeOrphanedSandboxContainers(new ProcessExecutor(), redeployedBackend, silent)).toBe(2);
    for (const orphan of orphans) expect(await exists(orphan)).toBe(false);
    expect(await exists(foreign)).toBe(true);
    expect(await removeOrphanedSandboxContainers(new ProcessExecutor(), redeployedBackend, silent)).toBe(0);
  }, 60_000);
});

describe("independent sandbox lifetime (real Docker)", () => {
  it("ends a running sandbox after its hard lifetime without any backend involved", async () => {
    const sketchDir = await mkdtemp(join(tmpdir(), "unosim-lifetime-"));
    try {
      await writeFile(join(sketchDir, "sketch.cpp"), "int main() { for (;;) {} }\n");
      const name = `unosim-sandbox-lifetime-${randomUUID().slice(0, 8)}`;
      const lifetimeSeconds = 12;
      const args = DockerCommandBuilder.buildSecureRunCommand({
        sketchDir,
        memoryMB: 256,
        cpuLimit: "1",
        pidsLimit: 50,
        imageName: IMAGE,
        containerName: name,
        // Like production (start-phase): the sandbox runs as the backend's user,
        // which owns the private sketch directory.
        user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        command: DockerCommandBuilder.buildCompileAndRunCommand(lifetimeSeconds),
      }).map((arg) => (arg === "-i" ? "-d" : arg));
      const startedAt = Date.now();
      const { stdout } = await run("docker", args);
      created.push(stdout.trim());

      // The compiled runtime is running, so the lifetime and not g++ ends it.
      let sawRuntime = false;
      while (Date.now() - startedAt < (lifetimeSeconds + 15) * 1_000 && await exists(stdout.trim())) {
        const logs = await run("docker", ["logs", name]).catch(() => ({ stdout: "" }));
        sawRuntime ||= logs.stdout.includes("[[RUNTIME_START]]");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const elapsedSeconds = (Date.now() - startedAt) / 1_000;

      expect(sawRuntime, `runtime marker never appeared within ${elapsedSeconds}s`).toBe(true);
      expect(await exists(stdout.trim())).toBe(false);
      expect(elapsedSeconds).toBeGreaterThanOrEqual(lifetimeSeconds - 1);
      expect(elapsedSeconds).toBeLessThan(lifetimeSeconds + 15);
    } finally {
      await rm(sketchDir, { recursive: true, force: true });
    }
  }, 90_000);
});

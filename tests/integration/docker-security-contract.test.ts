import { describe, expect, it } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { ProcessExecutor } from "../../server/services/process-executor";

const enabled = process.env.FORCE_DOCKER === "1" || process.env.UNOSIM_SIMULATION_MODE === "docker-sandbox";
const maybeDescribe = enabled ? describe : describe.skip;

async function waitForContainerName(runner: SandboxRunner): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const name = (runner as any).executionState?.currentContainerName as string | undefined;
    if (name) return name;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Sandbox container was not created in time");
}

maybeDescribe("Docker sandbox security contract", () => {
  it("applies isolation options to a real running container", async () => {
    const runner = new SandboxRunner();
    const runPromise = runner.runSketch({
      code: "void setup() {}\nvoid loop() { delay(100); }",
      timeoutSec: 5,
      onOutput: () => {},
      onError: () => {},
      onExit: () => {},
    });

    try {
      const containerName = await waitForContainerName(runner);
      const executor = new ProcessExecutor();
      let inspect = await executor.execute("docker", ["inspect", containerName], {
        timeout: 5_000,
        stdio: "pipe",
      });
      const inspectDeadline = Date.now() + 10_000;
      while (inspect.code !== 0 && Date.now() < inspectDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        inspect = await executor.execute("docker", ["inspect", containerName], {
          timeout: 5_000,
          stdio: "pipe",
        });
      }
      expect(inspect.code).toBe(0);
      const details = JSON.parse(inspect.stdout ?? "[]")[0];
      expect(details.HostConfig.NetworkMode).toBe("none");
      expect(details.HostConfig.ReadonlyRootfs).toBe(true);
      expect(details.HostConfig.CapDrop).toContain("ALL");
      expect(details.HostConfig.Tmpfs["/tmp"]).toContain("noexec");
      expect(details.Mounts.some((mount: { Destination: string }) => mount.Destination === "/sandbox")).toBe(true);
      expect(details.Mounts.some((mount: { Destination: string }) => mount.Destination.includes("arduino-cache"))).toBe(false);
    } finally {
      await runner.stop();
      await runPromise.catch(() => undefined);
    }
  }, 30_000);

  it("kills a silent container at the configured finite timeout", async () => {
    const runner = new SandboxRunner();
    const output: string[] = [];
    await runner.runSketch({
      code: "void setup() {}\nvoid loop() { delay(100); }",
      timeoutSec: 1,
      onOutput: (line) => output.push(line),
      onError: () => {},
      onExit: () => {},
    });

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    expect(output.join("\n")).toContain("Simulation timeout (1s)");
    expect(runner.isRunning).toBe(false);
  }, 30_000);
});

/**
 * Runner reuse while a start is still waiting for a sandbox-start slot.
 *
 * A waits for the only slot -> A stops -> the pool hands the same runner to B.
 * A must neither start a sandbox nor reach B's output or container lifecycle.
 * Real pool, runner, execution manager and semaphore; only the child process
 * and the Docker CLI are faked.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  type Listener<T> = (value: T) => void;
  class FakeChild {
    readonly stdout: Listener<Buffer>[] = [];
    readonly stderrLine: Listener<string>[] = [];
    readonly close: Listener<number | null>[] = [];
    constructor(readonly command: string, readonly args: string[]) {}
  }
  const spawned: FakeChild[] = [];
  const executed: string[][] = [];

  class FakeProcessController {
    private child: FakeChild | null = null;
    private stdoutListeners: Listener<Buffer>[] = [];
    private stderrLineListeners: Listener<string>[] = [];
    private closeListeners: Listener<number | null>[] = [];
    async spawn(command: string, args: string[] = []) {
      const child = new FakeChild(command, args);
      // Mirrors ProcessController: the child forwards to whatever listeners the controller holds.
      child.stdout.push((data) => this.stdoutListeners.forEach((cb) => cb(data)));
      child.stderrLine.push((line) => this.stderrLineListeners.forEach((cb) => cb(line)));
      child.close.push((code) => this.closeListeners.forEach((cb) => cb(code)));
      this.child = child;
      spawned.push(child);
      return null;
    }
    onStdout(cb: Listener<Buffer>) { this.stdoutListeners.push(cb); }
    onStderr() {}
    onStderrLine(cb: Listener<string>) { this.stderrLineListeners.push(cb); }
    supportsStderrLineStreaming() { return true; }
    onClose(cb: Listener<number | null>) { this.closeListeners.push(cb); }
    onError() {}
    writeStdin() { return true; }
    kill() {}
    destroySockets() {}
    hasProcess() { return this.child !== null; }
    clearListeners() { this.stdoutListeners = []; this.stderrLineListeners = []; this.closeListeners = []; }
    getPid() { return null; }
  }

  class FakeProcessExecutor {
    isBusy = false;
    async execute(command: string, args: string[]) {
      executed.push([command, ...args]);
      return { code: 0, stdout: "Docker version 27.0.0", stderr: "", error: null };
    }
    kill() {}
  }

  return { spawned, executed, FakeProcessController, FakeProcessExecutor };
});

vi.mock("../../../../server/services/process-controller", () => ({ ProcessController: fakes.FakeProcessController }));
vi.mock("../../../../server/services/process-executor", () => ({ ProcessExecutor: fakes.FakeProcessExecutor }));

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function mountedSketchDir(args: string[]): string {
  const mount = args[args.indexOf("-v") + 1];
  return mount.slice(0, mount.indexOf(":/sandbox"));
}

const ENV = {
  UNOSIM_SERVER_MODE: "docker",
  UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1",
  SANDBOX_START_MAX_CONCURRENT: "1",
  DOCKER_HOST: "tcp://unosim-test-docker:2375",
};
const previousEnv: Record<string, string | undefined> = {};

describe("runner reuse while a start waits for a sandbox slot", () => {
  beforeAll(() => {
    for (const [key, value] of Object.entries(ENV)) {
      previousEnv[key] = process.env[key];
      process.env[key] = value;
    }
    vi.resetModules();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("A waits -> A stops -> B takes over: A neither starts nor touches B", async () => {
    const { SandboxRunnerPool } = await import("../../../../server/services/sandbox-runner-pool");
    const { getSandboxStartSemaphore } = await import("../../../../server/services/sandbox/docker-compile-semaphore");
    const semaphore = getSandboxStartSemaphore(1);
    const releaseHeldSlot = await semaphore.acquire();

    const pool = new SandboxRunnerPool({ minRunners: 1, maxRunners: 1, acquireTimeoutMs: 1_000, resetTimeoutMs: 1_000 });
    await pool.initialize();

    const outputA: string[] = [];
    const exitA = vi.fn();
    const runnerA = await pool.acquireRunner();
    const runA = runnerA.runSketch({
      code: "void setup(){} void loop(){} // RUN_A",
      onOutput: (line) => outputA.push(line),
      onError: vi.fn(),
      onExit: exitA,
      timeoutSec: 30,
    });
    await waitFor(() => semaphore.queueLength === 1, "A queued for a start slot");

    await runnerA.stop();
    await pool.releaseRunner(runnerA);

    const outputB: string[] = [];
    const runnerB = await pool.acquireRunner();
    expect(runnerB).toBe(runnerA);
    const runB = runnerB.runSketch({
      code: "void setup(){} void loop(){} // RUN_B",
      onOutput: (line) => outputB.push(line),
      onError: vi.fn(),
      onExit: vi.fn(),
      timeoutSec: 30,
    });
    await waitFor(() => semaphore.queueLength >= 1, "B queued for a start slot");

    releaseHeldSlot();
    await waitFor(() => fakes.spawned.length >= 1, "a sandbox spawn");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(fakes.spawned).toHaveLength(1);
    const [sandbox] = fakes.spawned;
    // A stale start mounts A's directory, which A's stop already cleaned up.
    const sketch = await readFile(join(mountedSketchDir(sandbox.args), "sketch.cpp"), "utf8").catch(() => "<A's removed sketch dir>");
    expect(sketch).toContain("RUN_B");
    expect(sketch).not.toContain("RUN_A");

    const serialEvent = `[[SERIAL_EVENT:0:${Buffer.from("hello from B\n").toString("base64")}]]`;
    sandbox.stdout.forEach((cb) => cb(Buffer.from(`[[RUNTIME_START]]\n${serialEvent}\n`)));
    // The sandbox reports its (empty) I/O registry, which ends the registry wait.
    for (const line of ["[[IO_REGISTRY_START]]", "[[IO_REGISTRY_END]]"]) sandbox.stderrLine.forEach((cb) => cb(line));
    await expect(runB).resolves.toBe(true);
    await waitFor(() => outputB.some((line) => line.includes("hello from B")), "B output");
    expect(outputA.join("")).not.toContain("hello from B");
    await expect(runA).resolves.toBe(false);

    const removed = fakes.executed.filter(([command, verb]) => command === "docker" && verb === "rm");
    expect(removed).toEqual([]);

    await runnerB.stop();
    await pool.shutdown();
  });
});

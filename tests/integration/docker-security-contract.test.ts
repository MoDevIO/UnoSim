import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { SandboxRunnerPool } from "../../server/services/sandbox-runner-pool";
import { ProcessExecutor } from "../../server/services/process-executor";
import {
  extractPlainText,
  runSketchWithOutput,
} from "../utils/serial-test-helper";

const enabled = process.env.NODE_ENV === "test" &&
  process.env.UNOSIM_SERVER_MODE === "docker" &&
  process.env.UNOSIM_DOCKER_TEST_BYPASS_GATEWAY === "1";
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

async function waitForOutput(output: string[], target: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (extractPlainText(output).includes(target)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for sandbox output ${target}: ${extractPlainText(output)}`);
}

async function runSecurityProbe(sketch: string): Promise<string> {
  const runner = new SandboxRunner();
  try {
    const result = await runSketchWithOutput(runner, sketch, {
      timeout: 10,
      fallbackTimeout: 45_000,
    });
    expect(result.success, result.error).toBe(true);
    return extractPlainText(result.outputs);
  } finally {
    await runner.stop();
  }
}

maybeDescribe("Docker sandbox security contract", () => {
  it("confirms pause/resume and reuses the same runner after natural auto-removal", async () => {
    const pool = new SandboxRunnerPool({ minRunners: 1, maxRunners: 1 });
    await pool.initialize();
    const runner = await pool.acquireRunner();
    const executor = new ProcessExecutor();
    try {
      expect(await runner.runSketch({
        code: "void setup() {} void loop() { delay(100); }", timeoutSec: 10,
        onOutput: () => {}, onError: () => {}, onExit: () => {},
      })).toBe(true);
      const name = await waitForContainerName(runner);
      expect(runner.pause()).toBe(true);
      expect(await runner.controlResult).toBe(true);
      const paused = await executor.execute("docker", ["inspect", name], { timeout: 5000 });
      expect(paused.code).toBe(0);
      expect(JSON.parse(paused.stdout ?? "[]")[0].State.Paused).toBe(true);
      expect(runner.resume()).toBe(true);
      expect(await runner.controlResult).toBe(true);
      const resumed = await executor.execute("docker", ["inspect", name], { timeout: 5000 });
      expect(resumed.code).toBe(0);
      expect(JSON.parse(resumed.stdout ?? "[]")[0].State.Paused).toBe(false);
      await runner.stop();
      await pool.releaseRunner(runner);
      expect(await pool.acquireRunner()).toBe(runner);

      let exit!: () => void;
      const exited = new Promise<void>((resolve) => { exit = resolve; });
      await runner.runSketch({
        code: "#include <cstdlib>\nvoid setup() {} void loop() { exit(0); }", timeoutSec: 5,
        onOutput: () => {}, onError: () => {}, onExit: () => exit(),
      });
      await exited;
      await pool.releaseRunner(runner);
      expect(runner.hasPendingContainerCleanup).toBe(false);
      expect(await pool.acquireRunner()).toBe(runner);
    } finally {
      await runner.stop();
      await pool.shutdown();
    }
  }, 45_000);

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
      const sourceMount = details.Mounts.find((mount: { Destination: string }) => mount.Destination === "/sandbox");
      expect(sourceMount?.Type).toBe("bind");
      expect(sourceMount?.RW).toBe(false);
      expect(details.HostConfig.Tmpfs["/sandbox-work"]).toMatch(/size=(67108864|64m)/);
      expect(details.HostConfig.Tmpfs["/sandbox-work"]).toContain("nr_inodes=4096");
      expect(details.Mounts.some((mount: { Destination: string }) => mount.Destination.includes("arduino-cache"))).toBe(false);
      expect(await runPromise).toBe(true);
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

  it("keeps source read-only and caps sketch writes in per-run scratch", async () => {
    const runner = new SandboxRunner();
    const output: string[] = [];
    let runPromise: Promise<boolean> | undefined;

    try {
      runPromise = runner.runSketch({
        code: String.raw`
#include <cerrno>
#include <cstdlib>
#include <fcntl.h>
#include <unistd.h>

void setup() {
  int sourceFile = open("/sandbox/unosim-source-write-test", O_CREAT | O_WRONLY | O_EXCL, 0600);
  Serial.print("SOURCE_WRITE=");
  Serial.println(sourceFile < 0 ? "blocked" : "allowed");
  if (sourceFile >= 0) close(sourceFile);

  int scratchFile = open("scratch-limit-test.bin", O_CREAT | O_WRONLY | O_TRUNC, 0600);
  char block[1024 * 1024] = {};
  size_t written = 0;
  const size_t attemptLimit = 65ULL * 1024 * 1024;
  bool full = false;
  while (scratchFile >= 0 && written < attemptLimit) {
    size_t remaining = attemptLimit - written;
    size_t requested = remaining < sizeof(block) ? remaining : sizeof(block);
    ssize_t count = write(scratchFile, block, requested);
    if (count < 0) {
      full = errno == ENOSPC;
      break;
    }
    if (count == 0) break;
    written += static_cast<size_t>(count);
  }
  if (scratchFile >= 0) close(scratchFile);
  Serial.print("SCRATCH_LIMIT=");
  Serial.println(full ? "ENOSPC" : "NOT_ENFORCED");
}

void loop() { delay(100); }
`,
        timeoutSec: 30,
        onOutput: (chunk) => output.push(typeof chunk === "string" ? chunk : chunk.toString("utf8")),
        onError: (error) => output.push(error),
        onExit: () => {},
      });

      const containerName = await waitForContainerName(runner);
      await waitForOutput(output, "SCRATCH_LIMIT=", 30_000);

      const sketchDir = (runner as any).executionState?.currentSketchDir as string | null;
      expect(sketchDir).toBeTruthy();
      expect(existsSync(join(sketchDir!, "unosim-source-write-test"))).toBe(false);
      expect(existsSync(join(sketchDir!, "scratch-limit-test.bin"))).toBe(false);

      const inspect = await new ProcessExecutor().execute("docker", ["inspect", containerName], {
        timeout: 5_000,
        stdio: "pipe",
      });
      expect(inspect.code).toBe(0);
      const details = JSON.parse(inspect.stdout ?? "[]")[0];
      const sourceMount = details.Mounts.find((mount: { Destination: string }) => mount.Destination === "/sandbox");
      expect(sourceMount?.RW).toBe(false);
      expect(details.HostConfig.Tmpfs["/sandbox-work"]).toMatch(/size=(67108864|64m)/);
    } finally {
      await runner.stop();
      await runPromise?.catch(() => undefined);
    }

    const text = extractPlainText(output);
    expect(text).toContain("SOURCE_WRITE=blocked");
    expect(text).toContain("SCRATCH_LIMIT=ENOSPC");
  }, 60_000);

  it("blocks network egress from untrusted sketch code", async () => {
    const output = await runSecurityProbe(String.raw`
#include <arpa/inet.h>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>

void setup() {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  bool connected = false;
  if (fd >= 0) {
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(80);
    inet_pton(AF_INET, "203.0.113.1", &address.sin_addr);
    int rc = connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address));
    if (rc == 0) {
      connected = true;
    } else if (errno == EINPROGRESS) {
      fd_set writefds;
      FD_ZERO(&writefds);
      FD_SET(fd, &writefds);
      timeval tv{};
      tv.tv_usec = 100000;
      if (select(fd + 1, NULL, &writefds, NULL, &tv) > 0) {
        int socketError = 0;
        socklen_t len = sizeof(socketError);
        getsockopt(fd, SOL_SOCKET, SO_ERROR, &socketError, &len);
        connected = socketError == 0;
      }
    }
    close(fd);
  }

  Serial.print("NETWORK_EGRESS=");
  Serial.println(connected ? "unexpectedly-connected" : "blocked");
  exit(0);
}

void loop() {}
`);

    expect(output).toContain("NETWORK_EGRESS=blocked");
  }, 60_000);

  it("blocks common container escape primitives and host mounts", async () => {
    const output = await runSecurityProbe(String.raw`
#include <cstdio>
#include <cstdlib>
#include <sys/mount.h>
#include <sys/socket.h>
#include <unistd.h>

static bool canOpen(const char* path) {
  FILE* file = fopen(path, "r");
  if (file != NULL) {
    fclose(file);
    return true;
  }
  return false;
}

void setup() {
  int rawSocket = socket(AF_INET, SOCK_RAW, 1);
  if (rawSocket >= 0) {
    close(rawSocket);
  }

  int mountResult = mount("tmpfs", "/sandbox", "tmpfs", 0, "size=1m");

  Serial.print("DOCKER_SOCKET=");
  Serial.println(canOpen("/var/run/docker.sock") ? "present" : "absent");
  Serial.print("HOST_MOUNT=");
  Serial.println(canOpen("/host/etc/passwd") ? "present" : "absent");
  Serial.print("RAW_SOCKET=");
  Serial.println(rawSocket >= 0 ? "allowed" : "blocked");
  Serial.print("MOUNT_SYSCALL=");
  Serial.println(mountResult == 0 ? "allowed" : "blocked");

  exit(0);
}

void loop() {}
`);

    expect(output).toContain("DOCKER_SOCKET=absent");
    expect(output).toContain("HOST_MOUNT=absent");
    expect(output).toContain("RAW_SOCKET=blocked");
    expect(output).toContain("MOUNT_SYSCALL=blocked");
  }, 60_000);
});

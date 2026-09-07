import { describe, expect, it } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { ProcessExecutor } from "../../server/services/process-executor";
import {
  extractPlainText,
  runSketchWithOutput,
} from "../utils/serial-test-helper";

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

  it("enforces read-only root filesystem while keeping /sandbox writable", async () => {
    const output = await runSecurityProbe(String.raw`
#include <cstdio>
#include <cstdlib>

void setup() {
  FILE* rootFile = fopen("/etc/unosim-rootfs-write-test", "w");
  Serial.print("ROOTFS_WRITE=");
  Serial.println(rootFile == NULL ? "blocked" : "unexpectedly-open");
  if (rootFile != NULL) {
    fclose(rootFile);
  }

  FILE* sandboxFile = fopen("/sandbox/unosim-sandbox-write-test", "w");
  Serial.print("SANDBOX_WRITE=");
  Serial.println(sandboxFile == NULL ? "blocked" : "allowed");
  if (sandboxFile != NULL) {
    fputs("ok", sandboxFile);
    fclose(sandboxFile);
  }

  exit(0);
}

void loop() {}
`);

    expect(output).toContain("ROOTFS_WRITE=blocked");
    expect(output).toContain("SANDBOX_WRITE=allowed");
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

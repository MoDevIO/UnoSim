import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "../..");
const installer = readFileSync(join(repoRoot, "scripts/install-ubuntu-vbox.sh"), "utf8");
const servers: Server[] = [];

/** curl options of each readiness check, as the installer runs them (URL and TLS options excluded). */
function readinessCurlOptions(): Record<string, string[]> {
  const checks = [...installer.matchAll(/^(\w+_READINESS)="\$\(curl ([^\\\n]+)\\$/gm)];
  return Object.fromEntries(checks.map(([, name, options]) => [name, options.trim().split(/\s+/)]));
}

/**
 * Behaves like Docker's published port while the backend has not started to
 * listen yet: the first connections are accepted and reset, later ones are
 * answered by the backend.
 */
async function startResettingBackend(resets: number): Promise<{ url: string; connections: () => number }> {
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    if (connections <= resets) {
      socket.resetAndDestroy();
      return;
    }
    socket.once("data", () => {
      const body = '{"status":"ready"}';
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api/readiness`, connections: () => connections };
}

function curl(options: string[], url: string): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile("curl", [...options, url], { encoding: "utf8" }, (error, stdout) => {
      resolve({ exitCode: error ? Number(error.code) : 0, stdout });
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Ubuntu/VBox installer readiness checks", () => {
  it("finds both readiness checks of the installer", () => {
    expect(Object.keys(readinessCurlOptions()).sort()).toEqual(["BACKEND_READINESS", "GATEWAY_READINESS"]);
  });

  it.each(["BACKEND_READINESS", "GATEWAY_READINESS"])(
    "%s keeps retrying while the published port resets connections",
    async (check) => {
      const backend = await startResettingBackend(1);

      const result = await curl(readinessCurlOptions()[check], backend.url);

      expect(result).toEqual({ exitCode: 0, stdout: '{"status":"ready"}' });
      expect(backend.connections()).toBe(2);
    },
    20_000,
  );

  it("would give up after the first reset with connection-refused retries alone", async () => {
    // The former installer options: a fresh VM aborted with curl exit 56
    // because the backend listened about 0.3 s after `docker compose up -d`.
    const backend = await startResettingBackend(1);
    const formerOptions = readinessCurlOptions().BACKEND_READINESS.filter((option) => option !== "--retry-all-errors");

    const result = await curl(formerOptions, backend.url);

    expect(result.exitCode).toBe(56);
    expect(backend.connections()).toBe(1);
  }, 20_000);
});

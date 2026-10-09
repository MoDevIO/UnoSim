import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import {
  authorizeHeaders,
  createLocalHostGuard,
  createUserAuthorizationMiddleware,
  createWebSocketAuthorizationVerifier,
  isLocalClientAllowed,
  isLoopbackHostHeader,
  isWebSocketOriginAllowed,
  parseTrustConfig,
  type TrustConfig,
} from "../../../server/security/access-control";

const SECRET = "a-secure-gateway-secret-with-32-characters";
const gatewayTrust: TrustConfig = {
  mode: "gateway",
  gatewaySecret: SECRET,
  trustedProxy: "127.0.0.1",
};
const servers: http.Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("parseTrustConfig", () => {
  it("derives gateway authentication from the Docker runtime profile", () => {
    expect(
      parseTrustConfig(
        {
          NODE_ENV: "production",
          UNOSIM_GATEWAY_SECRET: SECRET,
          UNOSIM_TRUSTED_PROXY: "10.10.0.0/24",
        },
        { serverMode: "docker", dockerTestBypassGateway: false },
      ),
    ).toEqual({
      mode: "gateway",
      gatewaySecret: SECRET,
      trustedProxy: "10.10.0.0/24",
    });
  });

  it("uses local authentication for the local runtime profile", () => {
    expect(parseTrustConfig(
      { NODE_ENV: "development" },
      { serverMode: "local", dockerTestBypassGateway: false },
    )).toEqual({
      mode: "local",
    });
  });

  it("allows external local clients only under the explicit unsafe opt-in", () => {
    const localProfile = { serverMode: "local", dockerTestBypassGateway: false } as const;
    expect(parseTrustConfig({}, localProfile, true)).toEqual({ mode: "local", allowExternalLocalClients: true });
    expect(parseTrustConfig({}, { serverMode: "docker", dockerTestBypassGateway: true }, true)).toEqual({ mode: "local" });
  });

  it("uses local authentication only for the explicit Docker test bypass", () => {
    expect(parseTrustConfig(
      { NODE_ENV: "test" },
      { serverMode: "docker", dockerTestBypassGateway: true },
    )).toEqual({ mode: "local" });
  });

  it("rejects incomplete and invalid Docker gateway configuration", () => {
    const dockerProfile = { serverMode: "docker", dockerTestBypassGateway: false } as const;
    expect(() => parseTrustConfig({}, dockerProfile)).toThrow(
      /at least 32/,
    );
    expect(() =>
      parseTrustConfig({
        UNOSIM_GATEWAY_SECRET: SECRET,
      }, dockerProfile),
    ).toThrow(/UNOSIM_TRUSTED_PROXY/);
    expect(() =>
      parseTrustConfig({
        UNOSIM_GATEWAY_SECRET: SECRET,
        UNOSIM_TRUSTED_PROXY: "true",
      }, dockerProfile),
    ).toThrow(/explicit IP address or CIDR/);
  });

  it("accepts a complete gateway configuration", () => {
    expect(
      parseTrustConfig({
        NODE_ENV: "production",
        UNOSIM_GATEWAY_SECRET: SECRET,
        UNOSIM_TRUSTED_PROXY: "10.10.0.0/24",
      }, { serverMode: "docker", dockerTestBypassGateway: false }),
    ).toEqual({
      mode: "gateway",
      gatewaySecret: SECRET,
      trustedProxy: "10.10.0.0/24",
    });
  });
});

describe("authorizeHeaders", () => {
  it("provides a fixed identity in local mode and ignores spoofed identity headers", () => {
    expect(
      authorizeHeaders({ "x-unosim-subject": "attacker" }, { mode: "local" }),
    ).toEqual({
      allowed: true,
      identity: { subject: "local", roles: ["user"] },
    });
  });

  it("rejects missing or incorrect gateway credentials", () => {
    expect(authorizeHeaders({}, gatewayTrust)).toEqual({
      allowed: false,
      status: 401,
    });
    expect(
      authorizeHeaders(
        {
          "x-unosim-gateway-secret": `${SECRET}-wrong`,
          "x-unosim-subject": "student-1",
          "x-unosim-roles": "user",
        },
        gatewayTrust,
      ),
    ).toEqual({ allowed: false, status: 401 });
  });

  it("rejects invalid subjects and unauthorized roles", () => {
    expect(
      authorizeHeaders(
        {
          "x-unosim-gateway-secret": SECRET,
          "x-unosim-subject": "student 1",
          "x-unosim-roles": "user",
        },
        gatewayTrust,
      ),
    ).toEqual({ allowed: false, status: 401 });
    expect(
      authorizeHeaders(
        {
          "x-unosim-gateway-secret": SECRET,
          "x-unosim-subject": "student-1",
          "x-unosim-roles": "admin",
        },
        gatewayTrust,
      ),
    ).toEqual({ allowed: false, status: 403 });
  });

  it("returns the gateway identity for valid user headers", () => {
    expect(
      authorizeHeaders(
        {
          "x-unosim-gateway-secret": SECRET,
          "x-unosim-subject": "student-1",
          "x-unosim-roles": "user",
        },
        gatewayTrust,
      ),
    ).toEqual({
      allowed: true,
      identity: { subject: "student-1", roles: ["user"] },
    });
  });
});

describe("HTTP authorization middleware", () => {
  it("protects a route in gateway mode", async () => {
    const app = express();
    app.get(
      "/protected",
      createUserAuthorizationMiddleware(gatewayTrust),
      (_req, res) => {
        res.json({ subject: res.locals.unosimIdentity.subject });
      },
    );
    const server = await new Promise<http.Server>((resolve) => {
      const listeningServer = app.listen(0, () => resolve(listeningServer));
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing port");
    const url = `http://127.0.0.1:${address.port}/protected`;

    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, {
      headers: {
        "X-UnoSim-Gateway-Secret": SECRET,
        "X-UnoSim-Subject": "student-1",
        "X-UnoSim-Roles": "user",
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subject: "student-1" });
  });

  it("uses server-signed local sessions and keeps clients independent", async () => {
    const app = express();
    app.get(
      "/protected",
      createUserAuthorizationMiddleware({ mode: "local" }),
      (_req, res) => res.json({ subject: res.locals.unosimIdentity.subject }),
    );
    const server = await new Promise<http.Server>((resolve) => {
      const listeningServer = app.listen(0, () => resolve(listeningServer));
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    const url = `http://127.0.0.1:${address.port}/protected`;

    const first = await fetch(url);
    const firstBody = await first.json() as { subject: string };
    const cookie = first.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("Missing local session cookie");
    const sameClient = await fetch(url, { headers: { Cookie: cookie } });
    const secondClient = await fetch(url, {
      headers: { "X-UnoSim-Subject": firstBody.subject },
    });

    expect((await sameClient.json()).subject).toBe(firstBody.subject);
    expect((await secondClient.json()).subject).not.toBe(firstBody.subject);
    expect(firstBody.subject).toMatch(/^local\.[A-Za-z0-9_-]{22}$/);
  });
});

describe("WebSocket authorization verifier", () => {
  it("rejects an unauthenticated upgrade before protocol switching", () => {
    const done = vi.fn();
    const verifyClient = createWebSocketAuthorizationVerifier(gatewayTrust, [
      "https://classroom.example",
    ]);

    verifyClient(
      {
        origin: "https://classroom.example",
        secure: true,
        req: { headers: {} } as http.IncomingMessage,
      },
      done,
    );

    expect(done).toHaveBeenCalledWith(false, 401, "Unauthorized");
  });

  it("accepts an authenticated upgrade", () => {
    const done = vi.fn();
    const verifyClient = createWebSocketAuthorizationVerifier(gatewayTrust, [
      "https://classroom.example",
    ]);

    verifyClient(
      {
        origin: "https://classroom.example",
        secure: true,
        req: {
          headers: {
            origin: "https://classroom.example",
            "x-unosim-gateway-secret": SECRET,
            "x-unosim-subject": "student-1",
            "x-unosim-roles": "user",
          },
        } as http.IncomingMessage,
      },
      done,
    );

    expect(done).toHaveBeenCalledWith(true);
  });

  it("rejects an authenticated upgrade from an origin outside the allowlist", () => {
    const done = vi.fn();
    const verifyClient = createWebSocketAuthorizationVerifier(gatewayTrust, [
      "https://classroom.example",
    ]);

    verifyClient(
      {
        origin: "https://attacker.example",
        secure: true,
        req: {
          headers: {
            origin: "https://attacker.example",
            "x-unosim-gateway-secret": SECRET,
            "x-unosim-subject": "student-1",
            "x-unosim-roles": "user",
          },
        } as http.IncomingMessage,
      },
      done,
    );

    expect(done).toHaveBeenCalledWith(false, 403, "Forbidden origin");
  });

  it("rejects missing and malformed origins in gateway mode", () => {
    expect(
      isWebSocketOriginAllowed({}, gatewayTrust, ["https://classroom.example"]),
    ).toBe(false);
    expect(
      isWebSocketOriginAllowed(
        { origin: "https://classroom.example/path" },
        gatewayTrust,
        ["https://classroom.example"],
      ),
    ).toBe(false);
    expect(
      isWebSocketOriginAllowed(
        { origin: ["https://classroom.example", "https://attacker.example"] },
        gatewayTrust,
        ["https://classroom.example"],
      ),
    ).toBe(false);
  });

  it("allows originless local clients only from a loopback peer and checks supplied origins", () => {
    const localTrust: TrustConfig = { mode: "local" };
    expect(isWebSocketOriginAllowed({}, localTrust, [], "127.0.0.1")).toBe(true);
    expect(isWebSocketOriginAllowed({}, localTrust, [], "::ffff:127.0.0.1")).toBe(true);
    expect(isWebSocketOriginAllowed({}, localTrust, [], "::1")).toBe(true);
    expect(isWebSocketOriginAllowed({}, localTrust, [], "192.168.1.30")).toBe(false);
    expect(isWebSocketOriginAllowed({}, localTrust, [])).toBe(false);
    expect(
      isWebSocketOriginAllowed(
        { origin: "http://localhost:5173" },
        localTrust,
        ["http://localhost:5173"],
      ),
    ).toBe(true);
    expect(
      isWebSocketOriginAllowed(
        { origin: "https://attacker.example", host: "192.168.1.20:3000" },
        localTrust,
        ["http://localhost:5173"],
      ),
    ).toBe(false);
  });

  it("keeps originless external local clients only under the explicit unsafe opt-in", () => {
    const unsafeTrust: TrustConfig = { mode: "local", allowExternalLocalClients: true };
    expect(isWebSocketOriginAllowed({}, unsafeTrust, [], "192.168.1.30")).toBe(true);
  });
});

describe("local loopback boundary", () => {
  const localTrust: TrustConfig = { mode: "local" };
  const upgrade = (headers: http.IncomingHttpHeaders, remoteAddress: string, trust = localTrust) => {
    const done = vi.fn();
    createWebSocketAuthorizationVerifier(trust, ["http://localhost:3001"])(
      {
        origin: headers.origin ?? "",
        secure: false,
        req: { headers, socket: { remoteAddress } } as unknown as http.IncomingMessage,
      },
      done,
    );
    return done;
  };

  it("accepts localhost and numeric loopback Host headers with any port", () => {
    for (const host of ["localhost", "localhost:3000", "LOCALHOST:3001", "127.0.0.1:3000", "127.1.2.3", "[::1]:3000", "localhost:80"]) {
      expect(isLoopbackHostHeader(host), host).toBe(true);
    }
  });

  it("rejects LAN, rebinding and malformed Host headers", () => {
    for (const host of [undefined, "", "192.168.1.20:3001", "10.0.0.12", "evil.example:3000", "localhost.evil.example", "127.0.0.1.nip.io:3000", "[::ffff:192.168.1.20]:3000", "localhost@evil.example", "localhost/x", "localhost:3000 x"]) {
      expect(isLoopbackHostHeader(host), String(host)).toBe(false);
    }
  });

  it("rejects a LAN client that reaches the dev proxy by the machine's LAN address", () => {
    // Before the fix: Origin equal to Host was accepted in local mode, so a LAN
    // browser at http://192.168.1.20:3001 could start native sketch execution.
    const done = upgrade({ host: "192.168.1.20:3001", origin: "http://192.168.1.20:3001" }, "127.0.0.1");
    expect(done).toHaveBeenCalledWith(false, 403, "Forbidden host");
  });

  it("rejects an originless LAN client", () => {
    const done = upgrade({ host: "localhost:3000" }, "192.168.1.30");
    expect(done).toHaveBeenCalledWith(false, 403, "Forbidden origin");
  });

  it("rejects a DNS rebinding page whose own host name now resolves to loopback", () => {
    const done = upgrade({ host: "evil.example:3000", origin: "http://evil.example:3000" }, "127.0.0.1");
    expect(done).toHaveBeenCalledWith(false, 403, "Forbidden host");
  });

  it("accepts the local browser and originless local tools", () => {
    expect(upgrade({ host: "localhost:3001", origin: "http://localhost:3001" }, "127.0.0.1"))
      .toHaveBeenCalledWith(true, undefined, undefined, expect.anything());
    expect(upgrade({ host: "127.0.0.1:3000" }, "127.0.0.1"))
      .toHaveBeenCalledWith(true, undefined, undefined, expect.anything());
  });

  it("does not restrict gateway mode or the explicit unsafe local opt-in", () => {
    const lanRequest = { headers: { host: "192.168.1.20:3000" } } as http.IncomingMessage;
    expect(isLocalClientAllowed(lanRequest, gatewayTrust)).toBe(true);
    expect(isLocalClientAllowed(lanRequest, { mode: "local", allowExternalLocalClients: true })).toBe(true);
    expect(isLocalClientAllowed(lanRequest, localTrust)).toBe(false);
  });

  it("refuses HTTP requests for LAN and rebinding hosts before any route", async () => {
    const app = express();
    app.use(createLocalHostGuard(localTrust));
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
    const server = await new Promise<http.Server>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    const statusFor = (host: string) => new Promise<number>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: address.port, path: "/api/health", headers: { Host: host } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }).on("error", reject);
    });

    expect(await statusFor(`localhost:${address.port}`)).toBe(200);
    expect(await statusFor(`127.0.0.1:${address.port}`)).toBe(200);
    expect(await statusFor(`192.168.1.20:${address.port}`)).toBe(403);
    expect(await statusFor(`evil.example:${address.port}`)).toBe(403);
  });
});

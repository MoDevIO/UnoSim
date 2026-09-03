import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import {
  authorizeHeaders,
  createUserAuthorizationMiddleware,
  createWebSocketAuthorizationVerifier,
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
  it("uses local mode outside production", () => {
    expect(parseTrustConfig({ NODE_ENV: "development" })).toEqual({
      mode: "local",
    });
  });

  it("fails closed for production without an explicit gateway", () => {
    expect(() => parseTrustConfig({ NODE_ENV: "production" })).toThrow(
      /Production requires UNOSIM_TRUST_MODE=gateway/,
    );
  });

  it("rejects incomplete and invalid gateway configuration", () => {
    expect(() => parseTrustConfig({ UNOSIM_TRUST_MODE: "public" })).toThrow(
      /must be either/,
    );
    expect(() => parseTrustConfig({ UNOSIM_TRUST_MODE: "gateway" })).toThrow(
      /at least 32/,
    );
    expect(() =>
      parseTrustConfig({
        UNOSIM_TRUST_MODE: "gateway",
        UNOSIM_GATEWAY_SECRET: SECRET,
      }),
    ).toThrow(/UNOSIM_TRUSTED_PROXY/);
    expect(() =>
      parseTrustConfig({
        UNOSIM_TRUST_MODE: "gateway",
        UNOSIM_GATEWAY_SECRET: SECRET,
        UNOSIM_TRUSTED_PROXY: "true",
      }),
    ).toThrow(/explicit IP address or CIDR/);
  });

  it("accepts a complete gateway configuration", () => {
    expect(
      parseTrustConfig({
        NODE_ENV: "production",
        UNOSIM_TRUST_MODE: "gateway",
        UNOSIM_GATEWAY_SECRET: SECRET,
        UNOSIM_TRUSTED_PROXY: "10.10.0.0/24",
      }),
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

  it("allows originless local clients but checks origins when supplied", () => {
    const localTrust: TrustConfig = { mode: "local" };
    expect(isWebSocketOriginAllowed({}, localTrust, [])).toBe(true);
    expect(
      isWebSocketOriginAllowed(
        { origin: "http://localhost:5173" },
        localTrust,
        ["http://localhost:5173"],
      ),
    ).toBe(true);
    expect(
      isWebSocketOriginAllowed(
        { origin: "https://attacker.example" },
        localTrust,
        ["http://localhost:5173"],
      ),
    ).toBe(false);
  });
});

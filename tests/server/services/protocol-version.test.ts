import { describe, expect, it } from "vitest";
import {
  REST_API_VERSION,
  WEBSOCKET_PROTOCOL_VERSION,
  isSupportedRestApiVersion,
} from "../../../server/services/protocol-version";
import express from "express";
import { createServer } from "node:http";
import { apiVersionMiddleware } from "../../../server/services/protocol-version";

describe("protocol version contract", () => {
  it("declares stable REST and WebSocket versions", () => {
    expect(REST_API_VERSION).toBe("1.0.0");
    expect(WEBSOCKET_PROTOCOL_VERSION).toBe("1.0.0");
  });

  it("accepts exact and compatible major/minor REST versions", () => {
    expect(isSupportedRestApiVersion("1.0.0")).toBe(true);
    expect(isSupportedRestApiVersion("1.0")).toBe(true);
    expect(isSupportedRestApiVersion("1")).toBe(true);
    expect(isSupportedRestApiVersion("2.0.0")).toBe(false);
    expect(isSupportedRestApiVersion("garbage")).toBe(false);
  });

  it("rejects unsupported REST versions with a migration-friendly 406 response", async () => {
    const app = express();
    app.use("/api", apiVersionMiddleware);
    app.get("/api/status", (_req, res) => res.json({ status: "ok" }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { "Accept-Version": "2.0.0" },
    });
    expect(response.status).toBe(406);
    expect(response.headers.get("x-unosim-api-version")).toBe(REST_API_VERSION);
    await expect(response.json()).resolves.toMatchObject({
      error: "unsupported_api_version",
      supportedVersions: [REST_API_VERSION],
    });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});

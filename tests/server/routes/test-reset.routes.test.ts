import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import { registerTestResetRoute } from "../../../server/routes/test-reset.routes";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

async function postToReset(isTest: boolean, enabled: boolean) {
  const app = express();
  const stopAllRunnersAndNotify = vi.fn().mockResolvedValue({
    cleanedUpCount: 2,
    cleanedTestRunIds: ["run-a", "run-b"],
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  registerTestResetRoute(app, {
    isTest,
    enabled,
    getSimulationApi: () => ({ stopAllRunnersAndNotify }),
    logger,
  });

  const server = await new Promise<http.Server>((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/test-reset`,
    { method: "POST" },
  );

  return { response, stopAllRunnersAndNotify };
}

describe("POST /api/test-reset", () => {
  it.each([
    { isTest: false, enabled: false },
    { isTest: false, enabled: true },
    { isTest: true, enabled: false },
  ])("returns 404 when registration is not explicitly enabled: %o", async (options) => {
    const { response, stopAllRunnersAndNotify } = await postToReset(
      options.isTest,
      options.enabled,
    );

    expect(response.status).toBe(404);
    expect(stopAllRunnersAndNotify).not.toHaveBeenCalled();
  });

  it("cleans all runners when test mode and the feature flag are enabled", async () => {
    const { response, stopAllRunnersAndNotify } = await postToReset(true, true);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "reset",
      cleanedTestRunIds: ["run-a", "run-b"],
    });
    expect(stopAllRunnersAndNotify).toHaveBeenCalledOnce();
  });
});

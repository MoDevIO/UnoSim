import { describe, expect, it } from "vitest";
import type { UserConfig } from "vite";
import viteConfig from "../../vite.config";

describe("Vite development server configuration", () => {
  it("derives the HMR endpoint from the active Vite server", () => {
    const config = viteConfig as UserConfig;

    expect(config.server?.port).toBe(3001);
    expect(config.server).not.toHaveProperty("hmr");
  });

  it("listens on loopback only, because it proxies the native local backend", () => {
    // `host: true` bound every interface and let LAN clients reach /api and /ws.
    expect((viteConfig as UserConfig).server?.host).toBe("127.0.0.1");
  });
});

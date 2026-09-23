import { describe, expect, it } from "vitest";
import { formatStartupLine, getLocalIpv4Addresses, getStartupAccess, getStartupConfigurationEntries } from "../../server/startup-access";

const startupConfiguration = {
  serverMode: "local" as const,
  trustMode: "local",
  nodeEnv: "development",
  simulationMaxConcurrent: 40,
  admissionMax: 100,
  queueTimeoutMs: 60_000,
  sandboxStartMaxConcurrent: 8,
  sandboxStartSlotTimeoutMs: 30_000,
  compileMaxConcurrent: 9,
  rateLimitDisabled: false,
  listenHost: "127.0.0.1",
  port: 3000,
  sandboxMemoryMB: 256,
  sandboxCpuLimit: "1",
  fqbn: "arduino:avr:uno",
};

describe("startup access diagnostics", () => {
  it("shows only the backend URL for localhost-only listeners", () => {
    expect(getStartupAccess("127.0.0.1", 3000)).toEqual({ backendUrl: "http://127.0.0.1:3000", networkUrls: [] });
  });
  it("shows the backend URL and LAN URLs for wildcard listeners", () => {
    expect(getStartupAccess("0.0.0.0", 3000, { en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }] })).toEqual({ backendUrl: "http://127.0.0.1:3000", networkUrls: ["http://192.168.1.20:3000"] });
  });
  it("returns multiple suitable private IPv4 interfaces without duplicates", () => {
    expect(getLocalIpv4Addresses({ en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }, { address: "192.168.1.20", family: "IPv4", internal: false }], en1: [{ address: "10.0.0.12", family: 4, internal: false }], lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }] })).toEqual(["192.168.1.20", "10.0.0.12"]);
  });
  it("returns no LAN address when no suitable interface exists", () => {
    expect(getLocalIpv4Addresses({ lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }], bridge0: [{ address: "169.254.10.2", family: "IPv4", internal: false }], en0: [{ address: "2001:db8::1", family: "IPv6", internal: false }] })).toEqual([]);
  });
  it("aligns labelled and continuation access lines", () => {
    const networkLine = formatStartupLine("Network URL", "http://192.168.1.20:3000");
    const continuationLine = formatStartupLine("", "http://10.0.0.12:3000");
    const capacityLine = formatStartupLine("Concurrent max", "4");
    expect(networkLine).toContain("Network URL:");
    expect(networkLine.indexOf("http://")).toBe(continuationLine.indexOf("http://"));
    expect(capacityLine.indexOf("4")).toBe(networkLine.indexOf("http://") + 0);
  });
  it("labels the development listener as the backend and omits Docker details", () => {
    const entries = getStartupConfigurationEntries(startupConfiguration);
    const labels = entries.map(({ label }) => label);
    expect(entries).toContainEqual({ label: "Backend URL", value: "http://127.0.0.1:3000" });
    expect(labels).not.toContain("Local URL");
    expect(labels).toContain("Simulation capacity");
    expect(labels).toContain("Sandbox startup");
    expect(labels).not.toContain("Sandbox Memory MB");
    expect(labels).not.toContain("Sandbox CPU Limit");
  });
  it("includes semantic capacity details in Docker mode", () => {
    const entries = getStartupConfigurationEntries({ ...startupConfiguration, serverMode: "docker", trustMode: "gateway", nodeEnv: "production", listenHost: "0.0.0.0" });
    expect(entries).toEqual(expect.arrayContaining([
      { label: "Simulation capacity", value: "" },
      { label: "Concurrent max", value: "40" },
      { label: "Admission max", value: "100" },
      { label: "Queue timeout", value: "60 s" },
      { label: "Sandbox startup", value: "" },
      { label: "Concurrent max", value: "8" },
      { label: "Slot timeout", value: "30 s" },
      { label: "Compilation", value: "" },
      { label: "Concurrent max", value: "9" },
      { label: "Sandbox Memory MB", value: "256" },
      { label: "Sandbox CPU Limit", value: "1" },
    ]));
  });
});

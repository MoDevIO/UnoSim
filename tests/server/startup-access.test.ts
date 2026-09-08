import { describe, expect, it } from "vitest";
import { formatStartupLine, getLocalIpv4Addresses, getStartupAccess } from "../../server/startup-access";

describe("startup access diagnostics", () => {
  it("shows only the local URL for localhost-only listeners", () => {
    expect(getStartupAccess("127.0.0.1", 3000)).toEqual({
      localUrl: "http://127.0.0.1:3000",
      networkUrls: [],
    });
  });

  it("shows the local URL and LAN URLs for wildcard listeners", () => {
    expect(getStartupAccess("0.0.0.0", 3000, {
      en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
    })).toEqual({
      localUrl: "http://127.0.0.1:3000",
      networkUrls: ["http://192.168.1.20:3000"],
    });
  });

  it("returns multiple suitable private IPv4 interfaces without duplicates", () => {
    expect(
      getLocalIpv4Addresses({
        en0: [
          { address: "192.168.1.20", family: "IPv4", internal: false },
          { address: "192.168.1.20", family: "IPv4", internal: false },
        ],
        en1: [{ address: "10.0.0.12", family: 4, internal: false }],
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      }),
    ).toEqual(["192.168.1.20", "10.0.0.12"]);
  });

  it("returns no LAN address when no suitable interface exists", () => {
    expect(
      getLocalIpv4Addresses({
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        bridge0: [{ address: "169.254.10.2", family: "IPv4", internal: false }],
        en0: [{ address: "2001:db8::1", family: "IPv6", internal: false }],
      }),
    ).toEqual([]);
  });

  it("aligns labelled and continuation access lines", () => {
    const networkLine = formatStartupLine("Network URL", "http://192.168.1.20:3000");
    const continuationLine = formatStartupLine("", "http://10.0.0.12:3000");
    const dockerLine = formatStartupLine("Docker Compile Conc.", "4");

    expect(networkLine).toContain("Network URL:");
    expect(networkLine.indexOf("http://")).toBe(continuationLine.indexOf("http://"));
    expect(dockerLine.indexOf("4")).toBe(networkLine.indexOf("http://") + 0);
  });
});

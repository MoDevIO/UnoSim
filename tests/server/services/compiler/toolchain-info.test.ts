import { beforeEach, describe, expect, it, vi } from "vitest";
import { librariesFingerprint, parseCliVersion, parseCores, readToolchainInfo, resetToolchainInfoCache } from "../../../../server/services/compiler/toolchain-info";

const outputs: Record<string, unknown> = {
  "version --format json": { Application: "arduino-cli", VersionString: "1.5.1" },
  "core list --format json": { platforms: [{ id: "esp32:esp32", installed_version: "3.3.11" }, { id: "arduino:avr", installed_version: "1.8.8" }] },
  "lib list --format json": { installed_libraries: [{ library: { name: "Servo", version: "1.2.2" } }, { library: { name: "Wire", version: "1.0" } }] },
};
const runner = () => vi.fn(async (args: string[]) => outputs[args.join(" ")] ?? null);

beforeEach(() => resetToolchainInfoCache());

describe("toolchain info (plan E15)", () => {
  it("reads the CLI version, the installed cores sorted by id and a library fingerprint", async () => {
    const info = await readToolchainInfo(runner());

    expect(info.arduinoCli).toBe("1.5.1");
    expect(info.cores).toEqual([{ id: "arduino:avr", version: "1.8.8" }, { id: "esp32:esp32", version: "3.3.11" }]);
    expect(info.librariesFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the library fingerprint with any library name or version, not with their order", () => {
    const servo = { library: { name: "Servo", version: "1.2.2" } };
    const wire = { library: { name: "Wire", version: "1.0" } };
    const same = librariesFingerprint({ installed_libraries: [servo, wire] });

    expect(librariesFingerprint({ installed_libraries: [wire, servo] })).toBe(same);
    expect(librariesFingerprint({ installed_libraries: [servo, { library: { name: "Wire", version: "1.1" } }] })).not.toBe(same);
    expect(librariesFingerprint({ installed_libraries: [servo] })).not.toBe(same);
  });

  it("reports what the CLI does not tell as unknown", async () => {
    const info = await readToolchainInfo(vi.fn(async () => null));

    expect(info).toEqual({ arduinoCli: "unknown", cores: [], librariesFingerprint: "unknown" });
  });

  it("understands older output shapes", () => {
    expect(parseCliVersion({ version_string: "0.35.3" })).toBe("0.35.3");
    expect(parseCores([{ id: "arduino:avr", installed: "1.8.6" }])).toEqual([{ id: "arduino:avr", version: "1.8.6" }]);
    expect(librariesFingerprint([{ name: "Servo", version: "1" }])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("asks the CLI once per five minutes", async () => {
    const run = runner();
    let time = 0;

    await readToolchainInfo(run, () => time);
    await readToolchainInfo(run, () => time + 4 * 60_000);
    expect(run).toHaveBeenCalledTimes(3);

    time = 5 * 60_000 + 1;
    await readToolchainInfo(run, () => time);
    expect(run).toHaveBeenCalledTimes(6);
  });

  it("returns fixed values under test so that no test depends on the machine", async () => {
    const info = await readToolchainInfo();

    expect(info.arduinoCli).toBe("test-cli");
  });
});

describe("toolchain info for concurrent callers", () => {
  it("queries the CLI once for callers that arrive while a query runs", async () => {
    const run = runner();
    const infos = await Promise.all([readToolchainInfo(run), readToolchainInfo(run), readToolchainInfo(run)]);

    expect(run).toHaveBeenCalledTimes(3); // version, core list, lib list: one query
    expect(infos[1]).toBe(infos[0]);
    expect(infos[2]).toBe(infos[0]);
  });
});

import { describe, expect, it } from "vitest";
import { buildIdOf, createBuildIdentity, sameBuildIdentity, type BuildIdentityInput } from "../../../../server/services/compiler/build-identity";

const toolchain = {
  arduinoCli: "1.5.1",
  cores: [{ id: "arduino:avr", version: "1.8.8" }],
  librariesFingerprint: "f".repeat(64),
};
const base: BuildIdentityInput = { sketchHash: "a".repeat(64), fqbn: "arduino:avr:uno", toolchain, requestedLibraries: ["Servo", "Wire"], buildOptions: ["--verbose"] };
const idOf = (patch: Partial<BuildIdentityInput> = {}, toolchainPatch: Partial<typeof toolchain> = {}) =>
  buildIdOf(createBuildIdentity({ ...base, ...patch, toolchain: { ...toolchain, ...toolchainPatch } }));

describe("build identity (plan E15, ADR 0010)", () => {
  it("gives equal inputs the same 64-digit id", () => {
    expect(idOf()).toMatch(/^[0-9a-f]{64}$/);
    expect(idOf()).toBe(idOf());
  });

  it.each<[string, Partial<BuildIdentityInput>, Partial<typeof toolchain>]>([
    ["the source", { sketchHash: "b".repeat(64) }, {}],
    ["the board option in the FQBN", { fqbn: "arduino:avr:nano:cpu=atmega328" }, {}],
    ["the arduino-cli version", {}, { arduinoCli: "1.5.2" }],
    ["a core version", {}, { cores: [{ id: "arduino:avr", version: "1.8.9" }] }],
    ["an additional core", {}, { cores: [{ id: "ATTinyCore:avr", version: "1.5.2" }, { id: "arduino:avr", version: "1.8.8" }] }],
    ["the installed libraries", {}, { librariesFingerprint: "0".repeat(64) }],
    ["the requested libraries", { requestedLibraries: ["Servo"] }, {}],
    ["the build options", { buildOptions: ["--verbose", "--optimize-for-debug"] }, {}],
  ])("changes the id when %s changes", (_name, patch, toolchainPatch) => {
    expect(idOf(patch, toolchainPatch)).not.toBe(idOf());
  });

  it("changes the id with the artifact format", () => {
    const identity = createBuildIdentity(base);

    expect(buildIdOf({ ...identity, artifactFormat: identity.artifactFormat + 1 })).not.toBe(buildIdOf(identity));
  });

  it("does not depend on the order of requested libraries or on property order", () => {
    expect(idOf({ requestedLibraries: ["Wire", "Servo"] })).toBe(idOf());
    const identity = createBuildIdentity(base);
    const reordered = Object.fromEntries(Object.entries(identity).reverse());

    expect(sameBuildIdentity(reordered, identity)).toBe(true);
  });

  describe("sameBuildIdentity", () => {
    it("accepts the stored copy of the current identity after a JSON round trip", () => {
      const identity = createBuildIdentity(base);

      expect(sameBuildIdentity(JSON.parse(JSON.stringify(identity)), identity)).toBe(true);
    });

    it("rejects any difference, a missing field and non-objects", () => {
      const identity = createBuildIdentity(base);
      const { librariesFingerprint: _omitted, ...incomplete } = identity;

      expect(sameBuildIdentity({ ...identity, fqbn: "arduino:avr:mega:cpu=atmega2560" }, identity)).toBe(false);
      expect(sameBuildIdentity(incomplete, identity)).toBe(false);
      expect(sameBuildIdentity(null, identity)).toBe(false);
      expect(sameBuildIdentity("identity", identity)).toBe(false);
      expect(sameBuildIdentity(undefined, identity)).toBe(false);
    });
  });
});

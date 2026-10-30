import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileCompatibility, runtimeCompatibility } from "../../../../shared/libraries";
import {
  attachCatalogLibraries,
  type CatalogPackage,
  LIBRARY_CATALOG,
  libraryCatalogResponse,
  parseProvidedLibraries,
  type ProvidedLibrary,
  readProvidedLibraries,
  providedLibraryDir,
  resolveCompileLibraries,
} from "../../../../server/services/libraries/library-service";

const AUNIT = { name: "AUnit", version: "1.7.1" };
const AUNIT_SHA = "32ba9479d215b07b550703674ccd44575a58341340d143dc7e091bdaf99be796";
const provided = (entries: Partial<ProvidedLibrary>[] = [{}]): ProvidedLibrary[] =>
  entries.map((entry) => ({ ...AUNIT, sha256: AUNIT_SHA, dir: "/libs/AUnit-1.7.1/AUnit", ...entry }));

function catalogWith(patch: Partial<CatalogPackage>): CatalogPackage[] {
  return [{ ...LIBRARY_CATALOG[0], ...patch }];
}

describe("library catalog (SSOT Libraries §3, §12)", () => {
  it("offers AUnit and the hardware-free packages, each in one exact version", () => {
    expect(LIBRARY_CATALOG.map((entry) => `${entry.name}@${entry.version}`)).toEqual([
      "AUnit@1.7.1",
      "ArduinoJson@6.21.6",
      "CircularBuffer@1.4.0",
      "elapsedMillis@1.0.6",
      "Time@1.6.1",
    ]);
  });

  it("offers AUnit 1.7.1 with the checksum of the Arduino library index archive", () => {
    expect(LIBRARY_CATALOG[0]).toMatchObject({ sha256: AUNIT_SHA, includes: ["AUnit.h"], headers: ["AUnit.h", "AUnitVerbose.h"], dependencies: [] });
    expect(LIBRARY_CATALOG[0].archive.url).toBe("https://downloads.arduino.cc/libraries/github.com/bxparks/AUnit-1.7.1.zip");
  });

  it.each([
    ["ArduinoJson", "f274ddd00870be901966f19678c1b80f4e20f495009b7b12e193928f04113fae", "bblanchon/ArduinoJson-6.21.6.zip", ["ArduinoJson.h"]],
    ["CircularBuffer", "3b30610ac51a35d8528d5ea9be16ccfadc4bf32c8e46631d534ced81730f54b4", "rlogiacco/CircularBuffer-1.4.0.zip", ["CircularBuffer.hpp"]],
    ["elapsedMillis", "275f17009f76a7d48ed4baa2f015b3ed02d144a581a3a88f35ece79ed2d6a081", "pfeerick/elapsedMillis-1.0.6.zip", ["elapsedMillis.h"]],
    ["Time", "09db5897c234f5726523fb45a11e9b6b76e56940dcc0adbbcd32a9490fa09834", "PaulStoffregen/Time-1.6.1.zip", ["TimeLib.h"]],
  ])("offers %s with the checksum and archive of the Arduino library index, without dependencies", (name, sha256, archive, includes) => {
    const entry = LIBRARY_CATALOG.find((candidate) => candidate.name === name);

    expect(entry).toMatchObject({ sha256, includes, dependencies: [] });
    expect(entry?.archive.url).toBe(`https://downloads.arduino.cc/libraries/github.com/${archive}`);
  });

  it("states verified compile and browser runs on Uno, Nano and Mega 2560 for the new packages, Legacy as not supported", () => {
    for (const entry of LIBRARY_CATALOG.filter((candidate) => candidate.name !== "AUnit")) {
      for (const board of ["uno", "nano", "mega2560"] as const) {
        expect(compileCompatibility(entry, board).status).toBe("verified");
        expect(runtimeCompatibility(entry, board, "browser").status).toBe("verified");
      }
      expect(runtimeCompatibility(entry, "uno", "host-mock").status).toBe("unsupported");
      expect(compileCompatibility(entry, "attiny85").status).toBe("untested");
    }
  });

  it("names a package directory without characters the process allowlist refuses", () => {
    expect(providedLibraryDir({ name: "AUnit", version: "1.7.1" })).toBe("AUnit-1.7.1/AUnit");
    expect(providedLibraryDir({ name: "Adafruit GFX Library", version: "1.11.9" })).toBe("Adafruit_GFX_Library-1.11.9/Adafruit_GFX_Library");
  });
});

describe("resolveCompileLibraries (SSOT Libraries §10)", () => {
  it("resolves no requirements to no packages", () => {
    expect(resolveCompileLibraries([], "uno", provided())).toEqual({ ok: true, libraries: [] });
  });

  it("resolves AUnit to the provided package with its identity and directory", () => {
    expect(resolveCompileLibraries([AUNIT], "uno", provided())).toEqual({
      ok: true,
      libraries: [{ name: "AUnit", version: "1.7.1", sha256: AUNIT_SHA, dir: "/libs/AUnit-1.7.1/AUnit" }],
    });
  });

  it("refuses a version the catalog does not offer, without using another one", () => {
    expect(resolveCompileLibraries([{ name: "AUnit", version: "1.6.0" }], "uno", provided()))
      .toEqual({ ok: false, messages: ["AUnit 1.6.0 is not available on this server"] });
  });

  it("refuses a catalog package this deployment does not provide", () => {
    expect(resolveCompileLibraries([AUNIT], "uno", [])).toEqual({ ok: false, messages: ["AUnit 1.7.1 is not installed on this server"] });
  });

  it("refuses a provided package whose checksum differs from the catalog", () => {
    expect(resolveCompileLibraries([AUNIT], "uno", provided([{ sha256: "0".repeat(64) }])))
      .toEqual({ ok: false, messages: ["AUnit 1.7.1 failed its integrity check on this server"] });
  });

  it("refuses a board the package explicitly does not build for", () => {
    const catalog = catalogWith({ compatibility: { compile: [{ board: "attiny85", status: "unsupported", reason: "too little flash" }], runtime: [] } });

    expect(resolveCompileLibraries([AUNIT], "attiny85", provided(), catalog))
      .toEqual({ ok: false, messages: ["AUnit 1.7.1 does not support ATtiny85: too little flash"] });
  });

  it("lets an untested board try to compile", () => {
    expect(resolveCompileLibraries([AUNIT], "mega2560", provided()).ok).toBe(true);
  });
});

describe("libraryCatalogResponse", () => {
  it("states for each package whether this deployment provides it, without archive details", () => {
    const response = libraryCatalogResponse(provided());

    expect(response.schemaVersion).toBe(1);
    expect(response.packages[0]).toMatchObject({ name: "AUnit", version: "1.7.1", available: true });
    expect(response.packages[0]).not.toHaveProperty("archive");
    expect(libraryCatalogResponse([]).packages[0]).toMatchObject({ available: false, unavailableReason: "AUnit 1.7.1 is not installed on this server" });
  });
});

describe("provided libraries (provided.json of scripts/provision-libraries.mjs)", () => {
  const file = { schemaVersion: 1, packages: [{ name: "AUnit", version: "1.7.1", sha256: AUNIT_SHA, dir: "AUnit-1.7.1/AUnit" }] };

  it("places each package directory under the root the toolchain sees", () => {
    expect(parseProvidedLibraries(file, "/opt/unosim/libraries")).toEqual([{ ...AUNIT, sha256: AUNIT_SHA, dir: "/opt/unosim/libraries/AUnit-1.7.1/AUnit" }]);
  });

  it("provides nothing for a missing or malformed file and never leaves the root", () => {
    expect(parseProvidedLibraries(null, "/r")).toEqual([]);
    expect(parseProvidedLibraries({ schemaVersion: 1, packages: [{ ...file.packages[0], dir: "../etc" }] }, "/r")).toEqual([]);
  });

  it("reads the file of a root, or provides nothing when it is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "unosim-provided-"));
    try {
      expect(await readProvidedLibraries(root)).toEqual([]);
      writeFileSync(join(root, "provided.json"), JSON.stringify(file));
      expect(await readProvidedLibraries(root)).toEqual([{ ...AUNIT, sha256: AUNIT_SHA, dir: join(root, "AUnit-1.7.1/AUnit") }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("built-in package examples (SSOT Libraries §8.2)", () => {
  const record = (path: string) => ({
    id: `builtin-${path}`,
    title: path,
    category: "x",
    main: path.split("/").at(-1)!,
    source: "builtin" as const,
    files: [{ name: path.split("/").at(-1)!, path, content: "void setup(){}\nvoid loop(){}\n" }],
  });

  it("give the example the catalog maps to a package that package as direct requirement", () => {
    const [aunit, blink] = attachCatalogLibraries([record("libraries/AUnit/AUnitMinimal/AUnitMinimal.ino"), record("01-blink.ino")], [LIBRARY_CATALOG[0]]);

    expect(aunit.libraries).toEqual([AUNIT]);
    expect(blink).not.toHaveProperty("libraries");
  });

  it("refuse a mapping to a missing example or to one example from two packages", () => {
    expect(() => attachCatalogLibraries([record("01-blink.ino")])).toThrow(/libraries\/AUnit\/AUnitMinimal\/AUnitMinimal.ino.*not a built-in example/);
    const twice = catalogWith({})[0];
    expect(() => attachCatalogLibraries([record("libraries/AUnit/AUnitMinimal/AUnitMinimal.ino")], [twice, { ...twice, name: "Other" }]))
      .toThrow(/mapped to more than one package/);
  });

  it("hold for the real catalog and the shipped examples", async () => {
    const { BuiltInProvider } = await import("../../../../server/services/examples/built-in-provider");
    const examples = await new BuiltInProvider().getExamples();

    expect(examples.find((example) => example.id === "builtin-libraries-AUnit-AUnitMinimal-AUnitMinimal-ino")?.libraries).toEqual([AUNIT]);
    for (const entry of LIBRARY_CATALOG) {
      const example = examples.find((candidate) => candidate.files[0]?.path === entry.examples[0].path);
      expect(example?.libraries).toEqual([{ name: entry.name, version: entry.version }]);
    }
    expect(examples.filter((example) => example.libraries !== undefined)).toHaveLength(LIBRARY_CATALOG.length);
  });
});

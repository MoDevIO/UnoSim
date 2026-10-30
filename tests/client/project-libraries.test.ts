import { describe, expect, it } from "vitest";
import { downloadNotice } from "@/lib/library-download-notice";
import {
  addRequirement,
  includeAction,
  libraryListEntries,
  startBlockReason,
} from "@/lib/project-libraries";
import type { OfferedLibraryPackage } from "@shared/libraries";

const aunit: OfferedLibraryPackage = {
  name: "AUnit",
  version: "1.7.1",
  description: "Unit tests",
  author: "Brian T. Park",
  license: "MIT",
  documentationUrl: "https://github.com/bxparks/AUnit/tree/v1.7.1",
  headers: ["AUnit.h", "AUnitVerbose.h"],
  includes: ["AUnit.h"],
  dependencies: [],
  sha256: "a".repeat(64),
  examples: [],
  compatibility: {
    compile: [{ board: "uno", status: "verified" }],
    runtime: [
      { board: "uno", runtime: "browser", status: "verified" },
      { board: "uno", runtime: "host-mock", status: "unsupported", reason: "No libraries in the Legacy build." },
    ],
  },
  available: true,
};
const AUNIT = { name: "AUnit", version: "1.7.1" };

describe("libraryListEntries (SSOT Libraries §5.2)", () => {
  const status = (entry: { name: string; version: string; inProject: boolean; available: boolean }) =>
    [entry.name, entry.version, entry.inProject, entry.available];

  it("lists offered packages and required versions missing here once each, sorted", () => {
    const entries = libraryListEntries([aunit], [{ name: "Zeta", version: "1.0.0" }, AUNIT, { name: "AUnit", version: "1.6.0" }]);

    expect(entries.map(status)).toEqual([
      ["AUnit", "1.6.0", true, false],
      ["AUnit", "1.7.1", true, true],
      ["Zeta", "1.0.0", true, false],
    ]);
    expect(entries[1].offered).toBe(aunit);
    expect(entries[0].offered).toBeUndefined();
  });

  it("marks an offered version as in the project only by name and exact version", () => {
    const [offered, required] = libraryListEntries([aunit], [{ name: "AUnit", version: "1.6.0" }]).reverse();

    expect(status(offered)).toEqual(["AUnit", "1.7.1", false, true]);
    expect(status(required)).toEqual(["AUnit", "1.6.0", true, false]);
  });

  it("treats a catalog package the server does not provide as not available", () => {
    const [entry] = libraryListEntries([{ ...aunit, available: false, unavailableReason: "not installed" }], [AUNIT]);

    expect(status(entry)).toEqual(["AUnit", "1.7.1", true, false]);
    expect(entry.offered?.unavailableReason).toBe("not installed");
  });
});

describe("includeAction (SSOT Libraries §5.2, §6)", () => {
  const context = { localHeaders: ["sketch.ino"], fromFile: "sketch.ino" };

  it("offers Einbinden for a package that is not selected", () => {
    expect(includeAction(aunit, [], "void setup(){}", context)).toBe("include");
  });

  it("offers Include einfügen when it is selected but the active file lacks the include", () => {
    expect(includeAction(aunit, [AUNIT], "void setup(){}", context)).toBe("insert-include");
  });

  it("says Bereits eingebunden when selection and include are both there", () => {
    expect(includeAction(aunit, [AUNIT], "#include <AUnit.h>\n", context)).toBe("already-included");
  });

  it("offers nothing for a package this server does not provide or another selected version", () => {
    expect(includeAction({ ...aunit, available: false }, [], "", context)).toBe("unavailable");
    expect(includeAction(aunit, [{ name: "AUnit", version: "1.6.0" }], "", context)).toBe("other-version");
  });
});

describe("addRequirement", () => {
  it("adds once and keeps the order canonical", () => {
    const once = addRequirement([{ name: "Zeta", version: "1.0.0" }], AUNIT);

    expect(once).toEqual({ libraries: [AUNIT, { name: "Zeta", version: "1.0.0" }], added: true });
    expect(addRequirement(once.libraries, AUNIT)).toEqual({ libraries: once.libraries, added: false });
  });
});

describe("startBlockReason (SSOT Libraries §9)", () => {
  it("blocks a runtime the package does not support and names a supported engine", () => {
    expect(startBlockReason([AUNIT], [aunit], "uno", "host-mock", ["browser", "host-mock"]))
      .toBe("AUnit 1.7.1 does not run in the Legacy engine: No libraries in the Legacy build. Choose Emulation in Settings.");
  });

  it("lets verified and untested runtimes start", () => {
    expect(startBlockReason([AUNIT], [aunit], "uno", "browser", ["browser", "host-mock"])).toBeUndefined();
    expect(startBlockReason([AUNIT], [aunit], "nano", "browser", ["browser"])).toBeUndefined();
    expect(startBlockReason([], [aunit], "uno", "host-mock", ["browser", "host-mock"])).toBeUndefined();
  });
});

describe("downloadNotice (SSOT Libraries §8.1)", () => {
  it("names the selected packages with exact versions, and is absent without any", () => {
    expect(downloadNotice([AUNIT, { name: "Zeta", version: "1.0.0" }])).toBe(
      "Der Download enthält nur Quelltextdateien. Bibliotheksauswahl und Versionen sind nicht enthalten und müssen beim erneuten Laden wieder hinzugefügt werden. Bibliotheken: AUnit 1.7.1, Zeta 1.0.0",
    );
    expect(downloadNotice([])).toBeUndefined();
  });
});

describe("addRequirement and a selected version", () => {
  it("never changes the version a project has fixed", () => {
    expect(addRequirement([{ name: "AUnit", version: "1.6.0" }], AUNIT)).toEqual({ libraries: [{ name: "AUnit", version: "1.6.0" }], added: false });
  });
});

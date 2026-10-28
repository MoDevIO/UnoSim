import { describe, expect, it } from "vitest";
import {
  canonicalLibraries,
  compileCompatibility,
  findLibraryIncludeHints,
  hasEquivalentInclude,
  insertIncludes,
  type LibraryPackage,
  projectLibrariesSchema,
  resolveLibraryGraph,
  runtimeCompatibility,
} from "../../shared/libraries";

function pkg(name: string, version: string, extra: Partial<LibraryPackage> = {}): LibraryPackage {
  return {
    name,
    version,
    description: `${name} library`,
    author: "Author",
    license: "MIT",
    documentationUrl: `https://example.org/${name}`,
    headers: [`${name}.h`],
    includes: [`${name}.h`],
    dependencies: [],
    sha256: "a".repeat(64),
    examples: [],
    compatibility: { compile: [], runtime: [] },
    ...extra,
  };
}

describe("project library requirements (SSOT Libraries §4)", () => {
  it("accept exact versions", () => {
    expect(projectLibrariesSchema.parse([{ name: "AUnit", version: "1.7.1" }])).toEqual([{ name: "AUnit", version: "1.7.1" }]);
  });

  it.each([
    ["a wildcard", { name: "AUnit", version: "*" }],
    ["a range", { name: "AUnit", version: "^1.7.1" }],
    ["latest", { name: "AUnit", version: "latest" }],
    ["a missing version", { name: "AUnit" }],
    ["a bare name", "AUnit"],
    ["an unknown field", { name: "AUnit", version: "1.7.1", url: "https://example.org" }],
    ["a path as name", { name: "../AUnit", version: "1.7.1" }],
  ])("refuse %s", (_case, entry) => {
    expect(projectLibrariesSchema.safeParse([entry]).success).toBe(false);
  });

  it("allow a name only once", () => {
    const result = projectLibrariesSchema.safeParse([{ name: "AUnit", version: "1.7.1" }, { name: "AUnit", version: "1.7.0" }]);

    expect(result.success).toBe(false);
  });

  it("are ordered by name, so order changes neither resolution nor identity", () => {
    expect(canonicalLibraries([{ name: "Zeta", version: "1.0.0" }, { name: "AUnit", version: "1.7.1" }]))
      .toEqual([{ name: "AUnit", version: "1.7.1" }, { name: "Zeta", version: "1.0.0" }]);
  });
});

describe("resolveLibraryGraph (SSOT Libraries §3, §10)", () => {
  const catalog = [
    pkg("App", "1.0.0", { dependencies: [{ name: "Base", version: "2.0.0" }, { name: "Util", version: "1.0.0" }] }),
    pkg("Util", "1.0.0", { dependencies: [{ name: "Base", version: "2.0.0" }] }),
    pkg("Base", "2.0.0"),
    pkg("Base", "1.0.0"),
    pkg("Old", "1.0.0", { dependencies: [{ name: "Base", version: "1.0.0" }] }),
    pkg("Broken", "1.0.0", { dependencies: [{ name: "Gone", version: "9.9.9" }] }),
  ];

  it("returns the selection with its complete fixed dependencies, sorted", () => {
    const result = resolveLibraryGraph([{ name: "App", version: "1.0.0" }], catalog);

    expect(result.problems).toEqual([]);
    expect(result.packages.map((entry) => `${entry.name}@${entry.version}`)).toEqual(["App@1.0.0", "Base@2.0.0", "Util@1.0.0"]);
  });

  it("names a version the catalog does not offer and does not use another one", () => {
    const result = resolveLibraryGraph([{ name: "Base", version: "3.0.0" }], catalog);

    expect(result.packages).toEqual([]);
    expect(result.problems).toEqual([{ kind: "missing", name: "Base", version: "3.0.0" }]);
  });

  it("names a missing transitive dependency with the package that needs it", () => {
    expect(resolveLibraryGraph([{ name: "Broken", version: "1.0.0" }], catalog).problems)
      .toEqual([{ kind: "missing", name: "Gone", version: "9.9.9", requiredBy: "Broken@1.0.0" }]);
  });

  it("reports two versions of one package in the graph as a conflict", () => {
    const result = resolveLibraryGraph([{ name: "App", version: "1.0.0" }, { name: "Old", version: "1.0.0" }], catalog);

    expect(result.problems).toEqual([{ kind: "conflict", name: "Base", versions: ["1.0.0", "2.0.0"] }]);
  });
});

describe("compatibility (SSOT Libraries §9)", () => {
  const aunit = pkg("AUnit", "1.7.1", {
    compatibility: {
      compile: [{ board: "uno", status: "verified" }],
      runtime: [
        { board: "uno", runtime: "browser", status: "verified" },
        { board: "uno", runtime: "host-mock", status: "unsupported", reason: "no libraries in the legacy build" },
      ],
    },
  });

  it("reports the recorded statements", () => {
    expect(compileCompatibility(aunit, "uno")).toEqual({ status: "verified" });
    expect(runtimeCompatibility(aunit, "uno", "host-mock")).toEqual({ status: "unsupported", reason: "no libraries in the legacy build" });
  });

  it("treats missing evidence as untested, never as verified or unsupported", () => {
    expect(compileCompatibility(aunit, "mega2560")).toEqual({ status: "untested" });
    expect(runtimeCompatibility(aunit, "nano", "browser")).toEqual({ status: "untested" });
  });
});

describe("insertIncludes (SSOT Libraries §6)", () => {
  it("puts a new include behind the existing includes at the top", () => {
    const source = "#include <Servo.h>\n#include \"pins.h\"\n\nvoid setup() {}\nvoid loop() {}\n";

    expect(insertIncludes(source, ["AUnit.h"]).content)
      .toBe("#include <Servo.h>\n#include \"pins.h\"\n#include <AUnit.h>\n\nvoid setup() {}\nvoid loop() {}\n");
  });

  it("keeps a header comment and inserts above the code", () => {
    const source = "// Blink\n/* demo */\n\nvoid setup() {}\n";

    expect(insertIncludes(source, ["AUnit.h"]).content).toBe("// Blink\n/* demo */\n\n#include <AUnit.h>\n\nvoid setup() {}\n");
  });

  it("stays inside an include guard of a header", () => {
    const source = "#ifndef TESTS_H\n#define TESTS_H\n\nint answer();\n\n#endif\n";

    expect(insertIncludes(source, ["AUnit.h"]).content).toBe("#ifndef TESTS_H\n#define TESTS_H\n\n#include <AUnit.h>\n\nint answer();\n\n#endif\n");
  });

  it("inserts into an empty file", () => {
    expect(insertIncludes("", ["AUnit.h"]).content).toBe("#include <AUnit.h>\n");
  });

  it("does not add an include that is already there, also in quotes or with other spacing", () => {
    for (const source of ["#include <AUnit.h>\n", "#  include   \"AUnit.h\"\n", "  #include<AUnit.h>  // tests\n"]) {
      expect(insertIncludes(source, ["AUnit.h"])).toEqual({ content: source, inserted: [] });
    }
  });

  it("counts a commented-out include as missing", () => {
    expect(insertIncludes("// #include <AUnit.h>\nvoid setup() {}\n", ["AUnit.h"]).inserted).toEqual(["AUnit.h"]);
    expect(insertIncludes("/* #include <AUnit.h> */\nvoid setup() {}\n", ["AUnit.h"]).inserted).toEqual(["AUnit.h"]);
  });

  it("keeps Windows line endings", () => {
    expect(insertIncludes("#include <Servo.h>\r\nvoid setup() {}\r\n", ["AUnit.h"]).content)
      .toBe("#include <Servo.h>\r\n#include <AUnit.h>\r\nvoid setup() {}\r\n");
  });

  it("ignores includes further down in the code for the position", () => {
    const source = "void setup() {}\n#include <Late.h>\n";

    expect(insertIncludes(source, ["AUnit.h"]).content).toBe("#include <AUnit.h>\n\nvoid setup() {}\n#include <Late.h>\n");
  });
});

describe("hasEquivalentInclude", () => {
  it("does not count a quoted include that resolves to an own file as the library header", () => {
    expect(hasEquivalentInclude("#include \"AUnit.h\"\n", "AUnit.h", { localHeaders: ["AUnit.h"] })).toBe(false);
    expect(hasEquivalentInclude("#include \"AUnit.h\"\n", "AUnit.h")).toBe(true);
    expect(hasEquivalentInclude("#include <AUnit.h>\n", "AUnit.h", { localHeaders: ["AUnit.h"] })).toBe(true);
  });
});

describe("findLibraryIncludeHints (SSOT Libraries §7)", () => {
  const catalog = [
    pkg("AUnit", "1.7.1", { headers: ["AUnit.h", "AUnitVerbose.h"], includes: ["AUnit.h"] }),
    pkg("Display", "1.0.0", { headers: ["Display.h"], dependencies: [{ name: "Gfx", version: "2.0.0" }] }),
    pkg("Gfx", "2.0.0", { headers: ["Gfx.h"] }),
    pkg("TwinA", "1.0.0", { headers: ["Twin.h"] }),
    pkg("TwinB", "1.0.0", { headers: ["Twin.h"] }),
  ];
  const project = (files: Record<string, string>) => ({ entryFile: "sketch.ino", files });

  it("offers the catalog package of a known header the project does not select", () => {
    const hints = findLibraryIncludeHints(project({ "sketch.ino": "#include <AUnit.h>\nvoid setup(){}\n" }), [], catalog);

    expect(hints).toEqual([{ header: "AUnit.h", file: "sketch.ino", line: 1, candidates: [{ name: "AUnit", version: "1.7.1" }] }]);
  });

  it("is quiet when the package is selected directly or transitively", () => {
    const files = { "sketch.ino": "#include <AUnitVerbose.h>\n#include <Gfx.h>\n" };

    expect(findLibraryIncludeHints(project(files), [{ name: "AUnit", version: "1.7.1" }, { name: "Display", version: "1.0.0" }], catalog)).toEqual([]);
  });

  it("ignores own headers, core headers, unknown headers and commented includes", () => {
    const files = {
      "sketch.ino": "#include \"AUnit.h\"\n#include <Arduino.h>\n#include <Wire.h>\n#include <Unknown.h>\n// #include <Gfx.h>\n",
      "AUnit.h": "int x;\n",
    };

    expect(findLibraryIncludeHints(project(files), [], catalog)).toEqual([]);
  });

  it("offers every package of an ambiguous header and picks none", () => {
    expect(findLibraryIncludeHints(project({ "sketch.ino": "#include <Twin.h>\n" }), [], catalog)[0]?.candidates)
      .toEqual([{ name: "TwinA", version: "1.0.0" }, { name: "TwinB", version: "1.0.0" }]);
  });
});

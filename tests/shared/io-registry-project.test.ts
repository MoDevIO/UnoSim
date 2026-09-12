import { describe, expect, it } from "vitest";
import {
  analyzeStaticIO,
  analyzeStaticIOProject,
  parseStaticIORegistry,
  parseStaticIORegistryProject,
} from "../../shared/io-registry-parser";

describe("project-wide static I/O analysis", () => {
  it("keeps file and line provenance for resolved calls", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": '#include "led.h"\npinMode(4, OUTPUT);',
        "led.h": "digitalWrite(4, HIGH);",
      },
    });

    const calls = analysis.pins.find(({ pinId }) => pinId === 4)?.calls ?? [];
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "digitalWrite", file: "led.h", line: 1 }),
      expect.objectContaining({ op: "pinMode", file: "main.ino", line: 2 }),
    ]));
  });

  it("keeps nested call provenance and deterministic source order", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": '#include "a.h"\ndigitalWrite(9, HIGH);',
        "a.h": '#include "sub/b.h"\npinMode(4, OUTPUT);',
        "sub/b.h": "\n\n\n\n\n\ndigitalRead(4);",
      },
    });
    const calls = analysis.pins.flatMap(({ calls: pinCalls }) => pinCalls)
      .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));

    expect(calls).toEqual([
      expect.objectContaining({ op: "digitalRead", file: "sub/b.h", line: 7 }),
      expect.objectContaining({ op: "pinMode", file: "a.h", line: 2 }),
      expect.objectContaining({ op: "digitalWrite", file: "main.ino", line: 2 }),
    ]);
    expect(calls.map(({ sourceOrder }) => sourceOrder)).toEqual([6, 7, 8]);
  });

  it("resolves a symbol defined in a header when used later in the entry", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": '#include "pins.h"\ndigitalWrite(LED_PIN, HIGH);',
        "pins.h": "#define LED_PIN 4",
      },
    });

    expect(analysis.pins.find(({ pinId }) => pinId === 4)?.calls).toEqual([
      expect.objectContaining({ op: "digitalWrite", file: "main.ino", line: 2 }),
    ]);
  });

  it("makes symbols from an earlier header visible in a later header", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": '#include "pins.h"\n#include "io.h"',
        "pins.h": "#define LED_PIN 5",
        "io.h": "digitalWrite(LED_PIN, HIGH);",
      },
    });

    expect(analysis.pins.find(({ pinId }) => pinId === 5)?.calls).toEqual([
      expect.objectContaining({ op: "digitalWrite", file: "io.h", line: 1 }),
    ]);
  });

  it("does not resolve a use before a later definition", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": 'digitalWrite(LED_PIN, HIGH);\n#include "pins.h"',
        "pins.h": "#define LED_PIN 4",
      },
    });

    expect(analysis.unresolvedCalls).toEqual([
      expect.objectContaining({
        op: "digitalWrite",
        sourceExpression: "LED_PIN",
        file: "main.ino",
        line: 1,
      }),
    ]);
  });

  it("does not let a later redefinition change an earlier call", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": "#define LED_PIN 4\ndigitalWrite(LED_PIN, HIGH);\n#define LED_PIN 5\ndigitalWrite(LED_PIN, HIGH);",
      },
    });
    const calls = analysis.pins.flatMap(({ calls: pinCalls }) => pinCalls);

    expect(calls).toEqual([
      expect.objectContaining({ pinId: 4, line: 2 }),
      expect.objectContaining({ pinId: 5, line: 4 }),
    ]);
  });

  it("does not import symbols from unreachable files", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": "digitalWrite(UNUSED_PIN, HIGH);",
        "unused.h": "#define UNUSED_PIN 9",
      },
    });

    expect(analysis.pins).toEqual([]);
    expect(analysis.unresolvedCalls).toEqual([
      expect.objectContaining({ sourceExpression: "UNUSED_PIN", file: "main.ino" }),
    ]);
  });

  it("keeps I/O from unknown conditional branches as conservative facts", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": [
          "#if FEATURE",
          "digitalWrite(4, HIGH);",
          "#else",
          "digitalWrite(5, HIGH);",
          "#endif",
        ].join("\n"),
      },
    });

    expect(analysis.complete).toBe(false);
    expect(analysis.pins.map(({ pinId }) => pinId)).toEqual([4, 5]);
  });

  it("is deterministic regardless of file property insertion order", () => {
    const first = {
      entryFile: "main.ino",
      files: {
        "main.ino": '#include "a.h"\n#include "b.h"',
        "a.h": "digitalWrite(4, HIGH);",
        "b.h": "pinMode(5, OUTPUT);",
      },
    };
    const second = {
      entryFile: "main.ino",
      files: {
        "b.h": "pinMode(5, OUTPUT);",
        "a.h": "digitalWrite(4, HIGH);",
        "main.ino": '#include "a.h"\n#include "b.h"',
      },
    };

    expect(analyzeStaticIOProject(first)).toEqual(analyzeStaticIOProject(second));
  });

  it("keeps the legacy single-file APIs semantically unchanged", () => {
    const code = "#define LED_PIN 4\npinMode(LED_PIN, OUTPUT);\ndigitalWrite(LED_PIN, HIGH);";
    const legacy = analyzeStaticIO(code);
    const project = analyzeStaticIOProject({ entryFile: "main.ino", files: { "main.ino": code } });

    expect(project.pins.map(({ pinId, calls }) => ({
      pinId,
      calls: calls.map(({ file: _file, sourceOrder: _order, ...call }) => call),
    }))).toEqual(legacy.pins);
    expect(project.unresolvedCalls).toEqual(legacy.unresolvedCalls);
    const projectRegistry = parseStaticIORegistryProject({
      entryFile: "main.ino",
      files: { "main.ino": code },
    }).map(({ pinModeLocations: _pm, digitalWriteLocations: _dw, ...record }) => record);
    expect(projectRegistry).toEqual(parseStaticIORegistry(code));
  });

  it("projects source locations into the project registry", () => {
    const registry = parseStaticIORegistryProject({
      entryFile: "main.ino",
      files: {
        "main.ino": '#include "pins.h"',
        "pins.h": "pinMode(4, OUTPUT);\ndigitalWrite(4, HIGH);",
      },
    });
    const pin = registry.find(({ pinId }) => pinId === 4) as typeof registry[number] & {
      pinModeLocations?: Array<{ file: string; line: number }>;
      digitalWriteLocations?: Array<{ file: string; line: number }>;
    };

    expect(pin.pinModeLocations).toEqual([{ file: "pins.h", line: 1 }]);
    expect(pin.digitalWriteLocations).toEqual([{ file: "pins.h", line: 2 }]);
    });
  });

  it("keeps same-line declaration order", () => {
    const analysis = analyzeStaticIOProject({
      entryFile: "main.ino",
      files: {
        "main.ino": "digitalWrite(LED_PIN, HIGH); int LED_PIN = 4;",
      },
    });

    expect(analysis.unresolvedCalls).toEqual([
      expect.objectContaining({ sourceExpression: "LED_PIN", line: 1 }),
    ]);
  });

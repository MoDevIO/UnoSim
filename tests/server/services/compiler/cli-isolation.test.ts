import { mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCliIsolation, defaultArduinoUserDir } from "../../../../server/services/compiler/cli-isolation";

describe("arduino-cli isolation (SSOT Libraries §10)", () => {
  const work = mkdtempSync(join(tmpdir(), "unosim-isolation-test-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("hides the libraries of the host sketchbook and keeps its third-party cores", async () => {
    const realUser = join(work, "Arduino");
    mkdirSync(join(realUser, "hardware", "ATTinyCore"), { recursive: true });
    mkdirSync(join(realUser, "libraries", "AUnit"), { recursive: true });

    const env = await createCliIsolation(join(work, "isolated"), realUser);

    expect(Object.keys(env).sort((a, b) => a.localeCompare(b))).toEqual(["ARDUINO_DIRECTORIES_BUILTIN_LIBRARIES", "ARDUINO_DIRECTORIES_USER"]);
    expect(readdirSync(env.ARDUINO_DIRECTORIES_USER)).toEqual(["hardware"]);
    expect(readlinkSync(join(env.ARDUINO_DIRECTORIES_USER, "hardware"))).toBe(join(realUser, "hardware"));
    expect(readdirSync(env.ARDUINO_DIRECTORIES_BUILTIN_LIBRARIES)).toEqual([]);
  });

  it("can be created again, also concurrently, and without a hardware directory", async () => {
    const realUser = join(work, "Plain");
    mkdirSync(realUser, { recursive: true });

    const [first, second] = await Promise.all([createCliIsolation(join(work, "again"), realUser), createCliIsolation(join(work, "again"), realUser)]);

    expect(first).toEqual(second);
    expect(readdirSync(first.ARDUINO_DIRECTORIES_USER)).toEqual([]);
  });

  it("finds the sketchbook as arduino-cli does: the environment first, else the platform default", () => {
    expect(defaultArduinoUserDir({ ARDUINO_DIRECTORIES_USER: "/custom" }, "linux", "/home/a")).toBe("/custom");
    expect(defaultArduinoUserDir({}, "linux", "/home/a")).toBe("/home/a/Arduino");
    expect(defaultArduinoUserDir({}, "darwin", "/Users/a")).toBe("/Users/a/Documents/Arduino");
  });
});

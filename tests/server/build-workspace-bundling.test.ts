import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The server and worker bundles use `--packages=external`, so a workspace
 * package would stay an `import` at run time. The production image carries no
 * workspace links and the package exports TypeScript sources; its board entry
 * (`shared/boards.ts` imports it) must therefore be aliased into the bundle.
 */
const scripts = (JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

describe("workspace packages in the server bundles", () => {
  it.each(["build:server", "build:worker"])("%s bundles @unosim/avr-emulator/boards", (name) => {
    expect(scripts[name]).toContain("--alias:@unosim/avr-emulator/boards=./packages/avr-emulator/src/boards/index.ts");
  });
});

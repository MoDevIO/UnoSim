import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../../scripts/check-bundle-budget.mjs");
const tempDirs: string[] = [];

function runBudget(chunks: Record<string, string>, manifest: Record<string, unknown>) {
  const publicDir = mkdtempSync(join(tmpdir(), "unosim-bundle-"));
  tempDirs.push(publicDir);
  mkdirSync(join(publicDir, "assets"));
  mkdirSync(join(publicDir, ".vite"));
  for (const [name, source] of Object.entries(chunks)) writeFileSync(join(publicDir, "assets", name), source);
  writeFileSync(join(publicDir, ".vite", "manifest.json"), JSON.stringify(manifest));
  return spawnSync(process.execPath, [script, publicDir], { encoding: "utf8" });
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

/** Marks a chunk as containing the emulator (the two avr8js enum names the check looks for). */
const AVR8JS = "'PWMPhaseFrequencyCorrect','Internal2V56'";
const WORKER = { "emulator.worker-w9.js": AVR8JS };

describe("bundle budget initial load path", () => {
  const lazyManifest = {
    "index.html": { file: "assets/index-a1.js", isEntry: true, dynamicImports: ["plotter.tsx"] },
    "plotter.tsx": { file: "assets/serial-plotter-b2.js", isDynamicEntry: true },
  };

  it("passes when Recharts only lives in a lazily imported chunk", () => {
    const result = runBudget(
      { "index-a1.js": "console.log('app');", "serial-plotter-b2.js": "'recharts-wrapper'", ...WORKER },
      lazyManifest,
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).emulatorChunks).toEqual(["emulator.worker-w9.js"]);
  });

  it("fails when Recharts is part of the initial static chunk", () => {
    const result = runBudget({ "index-a1.js": "'recharts-wrapper'", "serial-plotter-b2.js": "" }, lazyManifest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Recharts is part of the initial load path");
  });

  it("fails when an eagerly imported shared chunk contains Recharts", () => {
    const result = runBudget(
      { "index-a1.js": "import './shared-c3.js';", "shared-c3.js": "'recharts-wrapper'", "serial-plotter-b2.js": "" },
      {
        "index.html": { file: "assets/index-a1.js", isEntry: true, imports: ["shared.js"] },
        "shared.js": { file: "assets/shared-c3.js" },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("shared-c3.js");
  });

  it("still enforces the index size limit", () => {
    const result = runBudget({ "index-a1.js": "x".repeat(745_001), ...WORKER }, { "index.html": { file: "assets/index-a1.js" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Bundle budget exceeded");
  });

  it("counts the whole initial load path against the limit, not only the index chunk", () => {
    const result = runBudget(
      { "index-a1.js": `import './shared-c3.js';${"x".repeat(400_000)}`, "shared-c3.js": "y".repeat(400_000), ...WORKER },
      {
        "index.html": { file: "assets/index-a1.js", isEntry: true, imports: ["shared.js"] },
        "shared.js": { file: "assets/shared-c3.js" },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Bundle budget exceeded");
  });

  it("fails when the emulator is part of the initial load path", () => {
    const result = runBudget({ "index-a1.js": `console.log(${AVR8JS});`, ...WORKER }, { "index.html": { file: "assets/index-a1.js" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("emulator (avr8js) is part of the initial load path");
    expect(result.stderr).toContain("index-a1.js");
  });

  it("fails when an eagerly imported shared chunk contains the emulator", () => {
    const result = runBudget(
      { "index-a1.js": "import './shared-c3.js';", "shared-c3.js": AVR8JS },
      {
        "index.html": { file: "assets/index-a1.js", isEntry: true, imports: ["shared.js"] },
        "shared.js": { file: "assets/shared-c3.js" },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("shared-c3.js");
  });

  it("fails when no chunk contains the emulator, because the check would pass for the wrong reason", () => {
    const result = runBudget({ "index-a1.js": "console.log('app');" }, { "index.html": { file: "assets/index-a1.js" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot be trusted");
  });
});

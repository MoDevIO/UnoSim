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

describe("bundle budget initial load path", () => {
  const lazyManifest = {
    "index.html": { file: "assets/index-a1.js", isEntry: true, dynamicImports: ["plotter.tsx"] },
    "plotter.tsx": { file: "assets/serial-plotter-b2.js", isDynamicEntry: true },
  };

  it("passes when Recharts only lives in a lazily imported chunk", () => {
    const result = runBudget(
      { "index-a1.js": "console.log('app');", "serial-plotter-b2.js": "'recharts-wrapper'" },
      lazyManifest,
    );
    expect(result.status).toBe(0);
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
    const result = runBudget({ "index-a1.js": "x".repeat(710_001) }, { "index.html": { file: "assets/index-a1.js" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Bundle budget exceeded");
  });
});

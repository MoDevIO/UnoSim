import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("CI lint command", () => {
  it("reports a fixable lint error without changing the checked source", () => {
    const repository = process.cwd();
    const manifest = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8"));
    const fixture = mkdtempSync(path.join(tmpdir(), "unosim-lint-contract-"));
    const source = "let value = 1; console.log(value);\n";

    try {
      writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
        type: "module",
        scripts: { lint: manifest.scripts.lint },
      }));
      writeFileSync(path.join(fixture, "eslint.config.js"),
        'export default [{ files: ["**/*.ts"], rules: { "prefer-const": "error" } }];\n');
      writeFileSync(path.join(fixture, "example.ts"), source);

      const result = spawnSync("npm", ["run", "lint"], {
        cwd: fixture,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${path.join(repository, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("prefer-const");
      expect(readFileSync(path.join(fixture, "example.ts"), "utf8")).toBe(source);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

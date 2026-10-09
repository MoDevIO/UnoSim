import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = join(__dirname, "../..");

describe("docker-compose backend logging", () => {
  it("rotates the backend's json-file log", () => {
    const compose = parse(readFileSync(join(repoRoot, "docker-compose.yml"), "utf8")) as {
      services: Record<string, { logging?: { driver?: string; options?: Record<string, string> } }>;
    };
    const logging = compose.services["unosim-backend"].logging;

    expect(logging?.driver).toBe("json-file");
    expect(logging?.options?.["max-size"]).toBe("${UNOSIM_LOG_MAX_SIZE:-10m}");
    expect(logging?.options?.["max-file"]).toBe("${UNOSIM_LOG_MAX_FILE:-5}");
  });
});

import { describe, expect, it, vi } from "vitest";
import { RevisionProvider } from "../../../server/services/examples/http-provider";

const revision = "a".repeat(40);
const manifest = JSON.stringify({
  schemaVersion: 1,
  repository: "legacy/wrong-repository",
  ref: "legacy-wrong-ref",
  examples: [{
    id: "example", title: "Example", category: "Test", main: "main.ino",
    files: [{ name: "main.ino", path: "examples/main.ino" }],
  }],
});

describe("revision provider", () => {
  it("loads all content exclusively from the selected revision and ignores legacy source metadata", async () => {
    const fetchText = vi.fn(async (url: URL) => url.pathname.endsWith("manifest.json") ? manifest : "void setup() {}");
    const loaded = await new RevisionProvider({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.examples[0]?.files[0]?.content).toBe("void setup() {}");
    expect(fetchText.mock.calls.every(([url]) => (url as URL).pathname.includes(`/${revision}/`))).toBe(true);
    expect(fetchText.mock.calls.some(([url]) => (url as URL).pathname.includes("legacy"))).toBe(false);
  });

  it("caps file fetch concurrency per complete snapshot", async () => {
    const manyFilesManifest = JSON.stringify({
      schemaVersion: 1,
      examples: [{
        id: "many", title: "Many", category: "Test", main: "main.ino",
        files: ["main.ino", "one.h", "two.h", "three.h"].map((name) => ({ name, path: name })),
      }],
    });
    let active = 0;
    let maximum = 0;
    const fetchText = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("manifest.json")) return manyFilesManifest;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return "content";
    });
    await new RevisionProvider({ fetchText }, 2).load("owner/repo", revision);
    expect(maximum).toBe(2);
  });
});

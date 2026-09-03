import { describe, expect, it } from "vitest";
import { resolvePathWithinRoot } from "../../../server/security/safe-paths";

describe("resolvePathWithinRoot", () => {
  it("resolves descendants below the requested root", () => {
    expect(resolvePathWithinRoot("/tmp/unosim", "sketch", "helper.h")).toBe(
      "/tmp/unosim/sketch/helper.h",
    );
  });

  it("rejects traversal and absolute child paths", () => {
    expect(() => resolvePathWithinRoot("/tmp/unosim", "../escape.h")).toThrow(
      /escapes its allowed root/,
    );
    expect(() => resolvePathWithinRoot("/tmp/unosim", "/tmp/escape.h")).toThrow(
      /escapes its allowed root/,
    );
  });

  it("rejects resolving the root itself", () => {
    expect(() => resolvePathWithinRoot("/tmp/unosim")).toThrow(
      /escapes its allowed root/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { detectParentOrigin } from "@/lib/parent-origin";

const own = "https://unosim.example";
const parent = "https://course.example";

function embedded(location: { ancestorOrigins?: string[] }, referrer?: string) {
  return { parent: {}, location: { origin: own, ...location }, document: { referrer } };
}

describe("detectParentOrigin", () => {
  it("uses the simulator's own origin top-level", () => {
    const win = { parent: undefined as unknown, location: { origin: own }, document: { referrer: `${parent}/x` } };
    win.parent = win;
    expect(detectParentOrigin(win)).toBe(own);
  });

  it("prefers location.ancestorOrigins where the browser provides it (Chromium, WebKit)", () => {
    expect(detectParentOrigin(embedded({ ancestorOrigins: [parent] }, "https://other.example/"))).toBe(parent);
  });

  it("derives the parent from the iframe referrer when ancestorOrigins is missing (Firefox)", () => {
    expect(detectParentOrigin(embedded({}, `${parent}/course/page?lesson=1`))).toBe(parent);
    expect(detectParentOrigin(embedded({ ancestorOrigins: [] }, `${parent}/`))).toBe(parent);
  });

  it("falls back to its own origin when no parent origin is known", () => {
    expect(detectParentOrigin(embedded({}, ""))).toBe(own);
    expect(detectParentOrigin(embedded({}, "not a url"))).toBe(own);
    expect(detectParentOrigin(embedded({}, "data:text/html,x"))).toBe(own);
  });
});

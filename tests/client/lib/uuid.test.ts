import { afterEach, describe, expect, it, vi } from "vitest";
import { generateUuidV4 } from "@/lib/uuid";

describe("generateUuidV4", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when available", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID });

    expect(generateUuidV4()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to crypto.getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      },
    });

    expect(generateUuidV4()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("returns a valid UUID v4 from the fallback", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([0, 1, 2, 3, 4, 5, 0xff, 7, 0xff, 9, 10, 11, 12, 13, 14, 15]);
        return bytes;
      },
    });

    const uuid = generateUuidV4();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

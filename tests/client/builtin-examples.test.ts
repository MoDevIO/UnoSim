import { afterEach, describe, expect, it, vi } from "vitest";
import { getExternalExamplesState, loadBuiltInExamplesCatalog, normalizeSelection, setExternalExamplesOverride } from "../../client/src/lib/external-examples";

const catalog = { schemaVersion: 1, source: { selection: "default", mode: "builtin", repository: null, ref: null, revision: null, status: "builtin", stale: false }, examples: [{ id: "blink", source: "builtin" }] };
afterEach(() => { vi.restoreAllMocks(); setExternalExamplesOverride(null); });

describe("built-in catalog client", () => {
  it("loads only its endpoint and does not alter external state", async () => {
    setExternalExamplesOverride(normalizeSelection("owner/repo", "main"));
    const before = getExternalExamplesState();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(catalog)));
    const signal = new AbortController().signal;
    await expect(loadBuiltInExamplesCatalog(signal)).resolves.toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledWith("/api/examples/builtin/catalog", { signal });
    expect(getExternalExamplesState()).toBe(before);
  });

  it.each([
    { ...catalog, source: { ...catalog.source, mode: "repository-ref" } },
    { ...catalog, source: { ...catalog.source, revision: "a".repeat(40) } },
    { ...catalog, examples: [{ id: "external", source: "external" }] },
    { ...catalog, examples: [null] },
  ])("rejects responses outside the built-in contract", async (payload) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(loadBuiltInExamplesCatalog()).rejects.toThrow();
  });
});

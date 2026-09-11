import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalExamplesSettings } from "../../client/src/components/features/external-examples-settings";
import {
  EXTERNAL_EXAMPLES_STORAGE_KEY,
  getExternalExamplesState,
  normalizeRepositoryInput,
  normalizeSelection,
  readStoredSelection,
  refreshExternalExamplesCatalog,
  setExternalExamplesOverride,
  validateExternalExamplesSelection,
} from "../../client/src/lib/external-examples";

const revision = "a".repeat(40);
const source = {
  selection: "default",
  mode: "repository-ref",
  repository: "owner/repo",
  ref: "main",
  revision,
  status: "remote",
  stale: false,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(EXTERNAL_EXAMPLES_STORAGE_KEY);
  setExternalExamplesOverride(null);
});

describe("external examples client contract", () => {
  it("normalizes public GitHub repositories and rejects unsafe input", () => {
    expect(normalizeRepositoryInput("Owner/Repo.git")).toBe("owner/repo");
    expect(normalizeRepositoryInput("https://github.com/Owner/Repo.git")).toBe(
      "owner/repo",
    );
    expect(
      normalizeRepositoryInput("https://github.com/Owner/Repo/tree/main"),
    ).toBeNull();
    expect(() => normalizeSelection("owner/repo", "main")).not.toThrow();
    expect(() => normalizeSelection("owner/repo", "feature/name")).toThrow();
  });

  it("ignores invalid persisted selections and stores only the exact schema", () => {
    localStorage.setItem(
      EXTERNAL_EXAMPLES_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        repository: "owner/repo",
        ref: "main",
      }),
    );
    expect(readStoredSelection()).toBeNull();
    const selection = normalizeSelection("owner/repo", "main");
    setExternalExamplesOverride(selection);
    expect(
      JSON.parse(localStorage.getItem(EXTERNAL_EXAMPLES_STORAGE_KEY)!),
    ).toEqual(selection);
    setExternalExamplesOverride(null);
    expect(localStorage.getItem(EXTERNAL_EXAMPLES_STORAGE_KEY)).toBeNull();
  });

  it("validates via POST and reports server error categories safely", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        valid: true,
        source: { ...source, selection: "browser-override" },
      }),
    } as Response);
    const result = await validateExternalExamplesSelection(
      normalizeSelection("owner/repo", "main"),
    );
    expect(result.revision).toBe(revision);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/examples/validate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"repository":"owner/repo"'),
      }),
    );
  });

  it("uses default and override catalog URLs and prevents stale responses winning", async () => {
    const first = Promise.resolve({
      ok: true,
      json: async () => ({ schemaVersion: 1, source, examples: [] }),
    } as Response);
    const second = Promise.resolve({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        source: {
          ...source,
          selection: "browser-override",
          repository: "other/repo",
        },
        examples: [],
      }),
    } as Response);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const firstLoad = refreshExternalExamplesCatalog();
    setExternalExamplesOverride(normalizeSelection("other/repo", "main"));
    const secondLoad = refreshExternalExamplesCatalog();
    await Promise.all([firstLoad, secondLoad]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/examples",
      "/api/examples?repository=other%2Frepo&ref=main",
    ]);
    expect(getExternalExamplesState().catalog?.source.repository).toBe(
      "other/repo",
    );
  });

  it("keeps the old override when validation fails", async () => {
    const oldSelection = normalizeSelection("old/repo", "main");
    setExternalExamplesOverride(oldSelection);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "INVALID_REF" } }), {
        status: 400,
      }),
    );
    render(<ExternalExamplesSettings open />);
    fireEvent.change(screen.getByLabelText("Ref"), {
      target: { value: "feature" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("ref is invalid"),
    );
    expect(
      JSON.parse(localStorage.getItem(EXTERNAL_EXAMPLES_STORAGE_KEY)!),
    ).toEqual(oldSelection);
  });

  it("applies a validated override and reset returns to the server default", async () => {
    setExternalExamplesOverride(normalizeSelection("old/repo", "main"));
    const newRevision = "b".repeat(40);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            valid: true,
            source: {
              selection: "browser-override",
              mode: "repository-ref",
              repository: "new/repo",
              ref: "main",
              revision: newRevision,
              status: "remote",
              stale: false,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            source: {
              selection: "browser-override",
              mode: "repository-ref",
              repository: "new/repo",
              ref: "main",
              revision: newRevision,
              status: "remote",
              stale: false,
            },
            examples: [],
          }),
          { status: 200 },
        ),
      );
    render(<ExternalExamplesSettings open />);
    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "new/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(EXTERNAL_EXAMPLES_STORAGE_KEY)!),
      ).toEqual(normalizeSelection("new/repo", "main")),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/examples/validate");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/examples?repository=new%2Frepo&ref=main",
    );

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          source: {
            selection: "default",
            mode: "builtin",
            repository: null,
            ref: null,
            revision: null,
            status: "builtin",
            stale: false,
          },
          examples: [],
        }),
        { status: 200 },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    await waitFor(() =>
      expect(localStorage.getItem(EXTERNAL_EXAMPLES_STORAGE_KEY)).toBeNull(),
    );
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/examples");
  });
});

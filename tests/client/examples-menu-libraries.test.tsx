import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamplesMenu } from "../../client/src/components/features/examples-menu";

vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext<{ open: boolean; setOpen: (value: boolean) => void }>({ open: false, setOpen: () => undefined });
  return {
    DropdownMenu: ({ open, onOpenChange, children }: any) => <Context.Provider value={{ open, setOpen: onOpenChange }}>{children}</Context.Provider>,
    DropdownMenuTrigger: ({ children }: any) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(children, { onClick: () => setOpen(!open) });
    },
    DropdownMenuContent: ({ children, ...props }: any) => {
      const { open } = React.useContext(Context);
      return open ? <div {...props}>{children}</div> : null;
    },
  };
});

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

afterEach(() => {
  vi.restoreAllMocks();
  toast.mockClear();
});

const SOURCE = { selection: "default", mode: "builtin", repository: null, ref: null, revision: null, status: "builtin", stale: false };
const EXAMPLE = { id: "builtin-aunit", title: "AUnitMinimal", category: "Built-in", source: "builtin", main: "AUnitMinimal.ino", files: [{ name: "AUnitMinimal.ino", path: "libraries/AUnit/AUnitMinimal/AUnitMinimal.ino" }] };

function serve(detail: unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/builtin/catalog") || url === "/api/examples" || url.startsWith("/api/examples?")) {
      return { ok: true, json: async () => ({ schemaVersion: 1, source: SOURCE, examples: [EXAMPLE] }) } as Response;
    }
    return { ok: true, json: async () => detail } as Response;
  });
}

async function load(onLoadExample: ReturnType<typeof vi.fn>, onExampleLibraries: ReturnType<typeof vi.fn>) {
  render(<ExamplesMenu onLoadExample={onLoadExample} onExampleLibraries={onExampleLibraries} />);
  fireEvent.click(screen.getByRole("button", { name: "Examples" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Built-in" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Built-in" }));
  fireEvent.click(screen.getByRole("button", { name: /AUnitMinimal\.ino/ }));
}

describe("ExamplesMenu and library requirements (SSOT Libraries §8.2)", () => {
  it("hands over the example's requirements right after its files", async () => {
    serve({ files: [{ name: "AUnitMinimal.ino", content: "x" }], libraries: [{ name: "AUnit", version: "1.7.1" }] });
    const calls: string[] = [];
    const onLoadExample = vi.fn(() => calls.push("files"));
    const onExampleLibraries = vi.fn(() => calls.push("libraries"));

    await load(onLoadExample, onExampleLibraries);

    await waitFor(() => expect(onExampleLibraries).toHaveBeenCalledWith([{ name: "AUnit", version: "1.7.1" }]));
    expect(calls).toEqual(["files", "libraries"]);
  });

  it("gives an example without requirements an empty selection", async () => {
    serve({ files: [{ name: "AUnitMinimal.ino", content: "x" }] });
    const onExampleLibraries = vi.fn();

    await load(vi.fn(), onExampleLibraries);

    await waitFor(() => expect(onExampleLibraries).toHaveBeenCalledWith([]));
  });

  it("loads nothing when the requirements are invalid", async () => {
    serve({ files: [{ name: "AUnitMinimal.ino", content: "x" }], libraries: [{ name: "AUnit", version: "*" }] });
    const onLoadExample = vi.fn();
    const onExampleLibraries = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await load(onLoadExample, onExampleLibraries);

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to Load Example" })));
    expect(onLoadExample).not.toHaveBeenCalled();
    expect(onExampleLibraries).not.toHaveBeenCalled();
  });
});

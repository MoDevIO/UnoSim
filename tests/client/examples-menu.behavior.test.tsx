import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamplesMenu } from "../../client/src/components/features/examples-menu";

vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext<{ open: boolean; setOpen: (value: boolean) => void }>({ open: false, setOpen: () => undefined });
  return {
    DropdownMenu: ({ open, onOpenChange, children }: any) => (
      <Context.Provider value={{ open, setOpen: onOpenChange }}>{children}</Context.Provider>
    ),
    DropdownMenuTrigger: ({ children }: any) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(children, { onClick: () => setOpen(!open) });
    },
    DropdownMenuContent: ({ children }: any) => {
      const { open } = React.useContext(Context);
      return open ? <div>{children}</div> : null;
    },
  };
});

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

afterEach(() => {
  vi.restoreAllMocks();
  toast.mockClear();
});

describe("ExamplesMenu behavior", () => {
  it("loads, groups, expands, and selects examples", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          examples: [
            { id: "blink", title: "blink.ino", category: "Other", files: [{ name: "blink.ino", path: "blink.ino" }] },
            { id: "io", title: "io.h", category: "Other", files: [{ name: "io.h", path: "io.h" }] },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ name: "blink.ino", content: "blink code" }] }) } as Response);
    const onLoadExample = vi.fn();

    render(<ExamplesMenu onLoadExample={onLoadExample} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    await waitFor(() => expect(screen.getByText("Load Example")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: /blink\.ino/i }));

    await waitFor(() => expect(onLoadExample).toHaveBeenCalledWith([{ name: "blink.ino", content: "blink code" }], "blink.ino"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Example Loaded" }));
  });

  it("shows an empty state when the backend is unreachable", async () => {
    render(<ExamplesMenu onLoadExample={vi.fn()} backendReachable={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Examples" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    await waitFor(() => expect(screen.getByText("No examples available")).toBeInTheDocument());
  });

  it("reports a failed examples request and ignores an individual failed file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 500 }));
    render(<ExamplesMenu onLoadExample={vi.fn()} />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to Load Examples" })));
  });

  it("toggles with the platform shortcut and honors keep-open storage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ examples: [{ id: "blink", title: "blink.ino", category: "Other", files: [{ name: "blink.ino", path: "blink.ino" }] }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ name: "blink.ino", content: "blink" }] }) } as Response);
    localStorage.setItem("unoKeepExamplesMenuOpen", "1");
    const onLoadExample = vi.fn();
    render(<ExamplesMenu onLoadExample={onLoadExample} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { code: "KeyE", ctrlKey: true });
    expect(screen.getByText("Load Example")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: /blink\.ino/i }));
    await waitFor(() => expect(onLoadExample).toHaveBeenCalledWith([{ name: "blink.ino", content: "blink" }], "blink.ino"));
    localStorage.removeItem("unoKeepExamplesMenuOpen");
  });
});

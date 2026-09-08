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

describe("ExamplesMenu behavior", () => {
  it("loads, groups, expands, and selects examples", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          examples: [
            { id: "blink", title: "Blink example", category: "Built-in", source: "builtin", files: [{ name: "01-blink.ino", path: "01-blink.ino" }] },
            { id: "io", title: "io.h", category: "Other", source: "builtin", files: [{ name: "io.h", path: "io.h" }] },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ name: "01-blink.ino", content: "blink code" }] }) } as Response);
    const onLoadExample = vi.fn();

    render(<ExamplesMenu onLoadExample={onLoadExample} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    await waitFor(() => expect(screen.getByText("Load Example")).toBeInTheDocument());
    const menuContent = screen.getByText("Load Example").parentElement?.parentElement;
    expect(menuContent).toHaveClass("w-72", "max-w-[calc(100vw-1rem)]", "overflow-y-auto");
    expect(menuContent).not.toHaveClass("max-h-96", "overflow-y-scroll");
    expect(menuContent).toHaveStyle({ maxHeight: "calc(var(--radix-dropdown-menu-content-available-height) - 10px)" });
    expect(screen.getByText("Load Example")).toHaveClass("ui-type-menu-title");
    fireEvent.click(screen.getByRole("button", { name: "Built-in" }));
    expect(screen.queryByRole("button", { name: "Built-in", exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Other" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /01-blink\.ino/ })).toHaveClass("ui-type-menu-item");
    fireEvent.click(screen.getByRole("button", { name: /01-blink\.ino/ }));

    await waitFor(() => expect(onLoadExample).toHaveBeenCalledWith([{ name: "01-blink.ino", content: "blink code" }], "01-blink.ino"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Example Loaded" }));
  });

  it("shows an empty state when the backend is unreachable", async () => {
    render(<ExamplesMenu onLoadExample={vi.fn()} backendReachable={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Examples" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    await waitFor(() => expect(screen.getByText("No examples available")).toBeInTheDocument());
  });

  it("keeps built-in filenames aligned in compact non-wrapping rows", async () => {
    const names = [
      "01-blink.ino",
      "02-digital-input.ino",
      "03-digital-io.ino",
      "04-analog-input.ino",
      "05-pwm-output.ino",
      "06-serial-monitor.ino",
      "07-serial-plotter.ino",
      "08-multiple-io.ino",
      "09-nonblocking-timing.ino",
      "10-unosim-showcase.ino",
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        examples: names.map((name) => ({
          id: name,
          title: name.replace(".ino", ""),
          category: "Built-in",
          source: "builtin",
          files: [{ name, path: name }],
        })),
      }),
    } as Response);

    render(<ExamplesMenu onLoadExample={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Examples" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    fireEvent.click(screen.getByRole("button", { name: "Built-in" }));

    const items = screen.getAllByRole("button", { name: /\.ino/ });
    expect(items).toHaveLength(names.length);
    expect(items.map((item) => item.className)).toEqual(Array(names.length).fill(items[0]?.className));
    names.forEach((name) => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
    items.forEach((item) => {
      expect(item.querySelector("span:last-child")).toHaveClass("truncate", "whitespace-nowrap");
    });
  });

  it("reports a failed examples request and ignores an individual failed file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 500 }));
    render(<ExamplesMenu onLoadExample={vi.fn()} />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to Load Examples" })));
  });

  it("toggles with the platform shortcut and honors keep-open storage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ examples: [{ id: "blink", title: "blink.ino", category: "Other", source: "builtin", files: [{ name: "blink.ino", path: "blink.ino" }] }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ name: "blink.ino", content: "blink" }] }) } as Response);
    localStorage.setItem("unoKeepExamplesMenuOpen", "1");
    const onLoadExample = vi.fn();
    render(<ExamplesMenu onLoadExample={onLoadExample} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { code: "KeyE", ctrlKey: true });
    expect(screen.getByText("Load Example")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Built-in" }));
    fireEvent.click(screen.getByRole("button", { name: /blink\.ino/i }));
    await waitFor(() => expect(onLoadExample).toHaveBeenCalledWith([{ name: "blink.ino", content: "blink" }], "blink.ino"));
    localStorage.removeItem("unoKeepExamplesMenuOpen");
  });

  it("separates built-in and external examples even when categories have the same name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        examples: [
          { id: "builtin-blink", title: "Built-in Blink", category: "01-basic", source: "builtin", files: [{ name: "blink.ino", path: "blink.ino" }] },
          { id: "external-blink", title: "External Blink", category: "01-basic", source: "external", files: [{ name: "blink.ino", path: "blink.ino" }] },
        ],
      }),
    } as Response);

    render(<ExamplesMenu onLoadExample={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Examples" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));

    expect(screen.getByRole("button", { name: "Built-in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "External" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "01-basic" })).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Built-in" }));
    expect(screen.getByRole("button", { name: /blink\.ino/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "basic" })).not.toBeInTheDocument();
    expect(screen.queryByText("External Blink")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Built-in" }));
    fireEvent.click(screen.getByRole("button", { name: "External" }));
    fireEvent.click(screen.getByRole("button", { name: "basic" }));
    expect(screen.getByText("External Blink")).toBeInTheDocument();
    expect(screen.queryByText("Built-in Blink")).not.toBeInTheDocument();
  });

  it("loads an external multi-file example through the existing detail endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          examples: [{
            id: "motor-control",
            title: "Motor Control",
            category: "Motors",
            source: "external",
            files: [
              { name: "motor-control.ino", path: "motors/motor-control/motor-control.ino" },
              { name: "motor.h", path: "motors/motor-control/motor.h" },
            ],
          }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          files: [
            { name: "motor-control.ino", content: "setup();" },
            { name: "motor.h", content: "void setup();" },
          ],
        }),
      } as Response);
    const onLoadExample = vi.fn();

    render(<ExamplesMenu onLoadExample={onLoadExample} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    fireEvent.click(screen.getByRole("button", { name: "External" }));
    fireEvent.click(screen.getByRole("button", { name: "Motors" }));
    fireEvent.click(screen.getByRole("button", { name: /Motor Control/ }));

    await waitFor(() => expect(onLoadExample).toHaveBeenCalledWith([
      { name: "motor-control.ino", content: "setup();" },
      { name: "motor.h", content: "void setup();" },
    ], "Motor Control"));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/examples/motor-control");
  });
});

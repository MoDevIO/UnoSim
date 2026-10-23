import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamplesMenu } from "../../client/src/components/features/examples-menu";
import { getExternalExamplesState, normalizeSelection, setExternalExamplesOverride } from "../../client/src/lib/external-examples";

vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext({ open: false, setOpen: (_open: boolean) => undefined });
  return {
    DropdownMenu: ({ open, onOpenChange, children }: any) => <Context.Provider value={{ open, setOpen: onOpenChange }}>{children}</Context.Provider>,
    DropdownMenuTrigger: ({ children }: any) => { const { open, setOpen } = React.useContext(Context); return React.cloneElement(children, { onClick: () => setOpen(!open) }); },
    DropdownMenuContent: ({ children, ...props }: any) => React.useContext(Context).open ? <div {...props}>{children}</div> : null,
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const local = { id: "builtin-blink", title: "Blink", category: "Built-in", source: "builtin", main: "01-blink.ino", files: [{ name: "01-blink.ino", path: "01-blink.ino" }] };
const remote = { id: "remote", title: "Remote example", category: "Basics", source: "external", main: "remote.ino", files: [{ name: "remote.ino", path: "remote.ino" }] };
const source = { selection: "default", mode: "builtin", repository: null, ref: null, revision: null, status: "builtin", stale: false };
const response = (examples: unknown[], external = false) => new Response(JSON.stringify({ schemaVersion: 1, source: external ? { ...source, mode: "repository-ref", repository: "owner/repo", ref: "main", revision: "a".repeat(40), status: "remote" } : source, examples }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const open = () => fireEvent.click(screen.getByRole("button", { name: "Examples" }));
afterEach(() => { vi.restoreAllMocks(); setExternalExamplesOverride(null); });

describe("independent examples menu availability", () => {
  it("does not write editor or Tutor context from a detail requested before a source change", async () => {
    const detail = deferred<Response>(); const onLoad = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith("/builtin/catalog")) return response([local]);
      if (url.includes("/api/examples/remote?")) return detail.promise;
      return response([remote], true);
    });
    render(<ExamplesMenu onLoadExample={onLoad} />); open();
    fireEvent.click(await screen.findByRole("button", { name: "External" }));
    fireEvent.click(screen.getByRole("button", { name: "Basics" }));
    fireEvent.click(screen.getByRole("button", { name: /Remote example/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/examples/remote?"))).toBe(true));
    act(() => setExternalExamplesOverride(normalizeSelection("other/repo", "main")));
    await act(async () => detail.resolve(new Response(JSON.stringify({ files: [{ name: "remote.ino", content: "old selection" }] }))));
    expect(onLoad).not.toHaveBeenCalled();
    expect(getExternalExamplesState().activeCourseContent).toBeNull();
  });

  it("settles a superseded shared request so the external group can be retried", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      if (String(input).endsWith("/builtin/catalog")) return response([local]);
      throw new DOMException("Superseded by another external catalog consumer", "AbortError");
    });
    render(<ExamplesMenu onLoadExample={vi.fn()} />); open();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Loading external examples...")).not.toBeInTheDocument();
  });

  it("aborts both requests on close and ignores their late failures", async () => {
    const external = deferred<Response>();
    const signals: AbortSignal[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      signals.push(init!.signal!);
      return String(input).endsWith("/builtin/catalog") ? response([local]) : external.promise;
    });
    render(<ExamplesMenu onLoadExample={vi.fn()} />); open();
    await screen.findByRole("button", { name: "Built-in" });
    open();
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await act(async () => external.resolve(new Response("", { status: 503 })));
    expect(screen.queryByText(/currently unavailable/)).not.toBeInTheDocument();
  });

  it("loads a local example while the external request is still pending", async () => {
    const pending = deferred<Response>(); const onLoad = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/builtin/catalog")) return response([local]);
      if (url.endsWith("/builtin-blink")) return new Response(JSON.stringify({ files: [{ name: "01-blink.ino", content: "blink code" }] }));
      return pending.promise;
    });
    render(<ExamplesMenu onLoadExample={onLoad} />); open();
    fireEvent.click(await screen.findByRole("button", { name: "Built-in" }));
    fireEvent.click(screen.getByRole("button", { name: /01-blink.ino/ }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith([{ name: "01-blink.ino", content: "blink code" }], "01-blink.ino"));
    await act(async () => pending.resolve(response([local, remote], true)));
  });

  it.each([503, 429])("keeps built-ins and retries only the failed external group after HTTP %s", async (status) => {
    let failed = true; const onLoad = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).endsWith("/builtin/catalog") ? response([local]) : failed ? new Response(JSON.stringify({ error: { code: status === 429 ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE" } }), { status }) : response([local, remote], true));
    render(<ExamplesMenu onLoadExample={onLoad} />); open();
    expect(await screen.findByText(/External examples are currently unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Built-in" })).toBeEnabled();
    failed = false; fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "External" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/builtin/catalog"))).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Built-in" })).toHaveLength(1);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("keeps external examples usable when the built-in request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => String(input).endsWith("/builtin/catalog") ? new Response("", { status: 500 }) : response([remote], true));
    render(<ExamplesMenu onLoadExample={vi.fn()} />); open();
    expect(await screen.findByRole("button", { name: "External" })).toBeEnabled();
    expect(screen.getByText(/Built-in examples are currently unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("No examples available")).not.toBeInTheDocument();
  });

  it("shows the empty state only after both groups successfully return empty", async () => {
    const pending = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => String(input).endsWith("/builtin/catalog") ? response([]) : pending.promise);
    render(<ExamplesMenu onLoadExample={vi.fn()} />); open();
    await waitFor(() => expect(screen.getByText(/Loading external examples/)).toBeInTheDocument());
    expect(screen.queryByText("No examples available")).not.toBeInTheDocument();
    await act(async () => pending.resolve(response([])));
    expect(await screen.findByText("No examples available")).toBeInTheDocument();
  });

  it("ignores an old external response after the browser selection changes", async () => {
    const old = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith("/builtin/catalog")) return response([local]);
      return url.includes("repository=") ? response([{ ...remote, id: "new", title: "New selection" }], true) : old.promise;
    });
    render(<ExamplesMenu onLoadExample={vi.fn()} />); open();
    await screen.findByRole("button", { name: "Built-in" });
    act(() => setExternalExamplesOverride(normalizeSelection("other/repo", "main")));
    fireEvent.click(await screen.findByRole("button", { name: "External" }));
    fireEvent.click(screen.getByRole("button", { name: "Basics" }));
    expect(screen.getByText("New selection")).toBeInTheDocument();
    await act(async () => old.resolve(response([remote], true)));
    expect(screen.getByText("New selection")).toBeInTheDocument();
    expect(screen.queryByText("Remote example")).not.toBeInTheDocument();
  });
});

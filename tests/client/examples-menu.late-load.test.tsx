import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExamplesMenu } from "@/components/features/examples-menu";
import { useChangeGuard } from "@/hooks/use-change-guard";
import { getExternalExamplesState, setActiveExternalExampleContext } from "@/lib/external-examples";

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Context = React.createContext<{ open: boolean; setOpen: (value: boolean) => void }>({ open: false, setOpen: () => undefined });
  return {
    DropdownMenu: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (value: boolean) => void; children: React.ReactNode }) =>
      React.createElement(Context.Provider, { value: { open, setOpen: onOpenChange } }, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactElement<{ onClick?: () => void }> }) => {
      const context = React.useContext(Context);
      return React.cloneElement(children, { onClick: () => context.setOpen(!context.open) });
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (React.useContext(Context).open ? React.createElement("div", null, children) : null),
  };
});

const source = { selection: "default", mode: "builtin", repository: null, ref: null, revision: null, status: "builtin", stale: false };
const item = { id: "builtin-demo", title: "Demo", category: "Built-in", main: "demo.ino", source: "builtin", files: [{ name: "demo.ino", path: "demo.ino" }] };

function Harness() {
  const [code, setCode] = React.useState("// original");
  const markProject = useChangeGuard([code]);
  return (
    <>
      <ExamplesMenu onLoadExample={(files) => setCode(files[0]?.content ?? "")} onBeginExampleLoad={markProject} />
      <button type="button" onClick={() => setCode("// edit")}>Edit code</button>
      <output data-testid="code">{code}</output>
    </>
  );
}

let releaseDetail: (response: Response) => void;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0));
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url === "/api/examples/builtin/catalog") return Promise.resolve(new Response(JSON.stringify({ schemaVersion: 1, source, examples: [item] })));
    if (url === "/api/examples") return Promise.resolve(new Response(JSON.stringify({ schemaVersion: 1, source, examples: [] })));
    if (url === "/api/config") return Promise.resolve(new Response("{}"));
    return new Promise((resolve) => { releaseDetail = resolve; });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  toast.mockClear();
});

async function chooseExample() {
  fireEvent.click(screen.getByRole("button", { name: "Examples", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Built-in", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: /demo\.ino/ }));
  await waitFor(() => expect(releaseDetail).toBeTypeOf("function"));
}

it("keeps an edit made while an example loads and starts no new learning situation", async () => {
  render(<Harness />);
  await chooseExample();
  const situation = getExternalExamplesState().learningSituation;
  fireEvent.click(screen.getByRole("button", { name: "Edit code" }));
  await act(async () => releaseDetail(new Response(JSON.stringify({ files: [{ name: "demo.ino", content: "// late example" }] }))));

  expect(screen.getByTestId("code").textContent).toBe("// edit");
  expect(getExternalExamplesState().learningSituation).toBe(situation);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Example not loaded: edit kept" }));
});

it("takes the example over when nothing changed, as a new learning situation", async () => {
  setActiveExternalExampleContext({ repository: "owner/repo", ref: "main", revision: "a".repeat(40), exampleId: "alt" });
  render(<Harness />);
  await chooseExample();
  const situation = getExternalExamplesState().learningSituation;
  await act(async () => releaseDetail(new Response(JSON.stringify({ files: [{ name: "demo.ino", content: "// example" }] }))));

  await waitFor(() => expect(screen.getByTestId("code").textContent).toBe("// example"));
  expect(getExternalExamplesState().learningSituation).toBe(situation + 1);
  expect(getExternalExamplesState().activeCourseContent).toBeNull();
});

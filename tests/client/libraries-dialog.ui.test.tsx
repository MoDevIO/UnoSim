import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LibrariesDialog, type LibrariesDialogProps } from "@/components/features/libraries-dialog";
import type { OfferedLibraryPackage } from "@shared/libraries";

const aunit: OfferedLibraryPackage = {
  name: "AUnit",
  version: "1.7.1",
  description: "A unit testing framework for Arduino platforms.",
  author: "Brian T. Park",
  license: "MIT",
  documentationUrl: "https://github.com/bxparks/AUnit/tree/v1.7.1",
  headers: ["AUnit.h", "AUnitVerbose.h"],
  includes: ["AUnit.h"],
  dependencies: [],
  sha256: "a".repeat(64),
  examples: [{ title: "AUnit minimal example", path: "libraries/AUnit/AUnitMinimal/AUnitMinimal.ino", exampleId: "builtin-aunit" }],
  compatibility: {
    compile: [{ board: "uno", status: "verified" }],
    runtime: [
      { board: "uno", runtime: "browser", status: "verified" },
      { board: "uno", runtime: "host-mock", status: "unsupported", reason: "No libraries in the Legacy build." },
    ],
  },
  available: true,
};

function renderDialog(overrides: Partial<LibrariesDialogProps> = {}) {
  const props: LibrariesDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    boardId: "uno",
    boardName: "Arduino UNO",
    runtime: "browser",
    catalog: { status: "ready", packages: [aunit], retry: vi.fn(async () => undefined) },
    libraries: [],
    activeFile: { path: "sketch.ino", editable: true, content: "void setup(){}\nvoid loop(){}\n", localHeaders: ["sketch.ino"] },
    onInclude: vi.fn(),
    onInsertInclude: vi.fn(),
    onOpenExample: vi.fn(),
    ...overrides,
  };
  render(<LibrariesDialog {...props} />);
  return props;
}

describe("LibrariesDialog (SSOT Libraries §5)", () => {
  it("names board and engine and lists the offered packages", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Libraries" })).toBeInTheDocument();
    expect(screen.getByText("Arduino UNO · Emulation")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Verfügbar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /AUnit 1\.7\.1/ })).toBeInTheDocument();
    expect(screen.queryByText(/Wähle eine Bibliothek/)).toBeNull();
  });

  it("tells loading, a failed fetch with retry, an empty catalog, no hits and an empty project apart", async () => {
    const user = userEvent.setup();
    const retry = vi.fn(async () => undefined);
    const { unmount } = render(<LibrariesDialog {...renderProps({ catalog: { status: "loading", packages: [], retry } })} />);
    expect(screen.getByText("Bibliotheken werden geladen …")).toBeInTheDocument();
    unmount();

    const failed = render(<LibrariesDialog {...renderProps({ catalog: { status: "error", packages: [], retry } })} />);
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(retry).toHaveBeenCalledOnce();
    failed.unmount();

    const empty = render(<LibrariesDialog {...renderProps({ catalog: { status: "ready", packages: [], retry } })} />);
    expect(screen.getByText("Dieser Server bietet keine Bibliotheken an.")).toBeInTheDocument();
    empty.unmount();

    render(<LibrariesDialog {...renderProps()} />);
    await user.type(screen.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }), "servo");
    expect(screen.getByText("Keine Treffer für „servo“.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Im Projekt" }));
    await user.clear(screen.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }));
    expect(screen.getByText("Diesem Projekt sind noch keine Bibliotheken zugeordnet.")).toBeInTheDocument();
  });

  it("finds a package by its description", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }), "unit testing");

    expect(screen.getByRole("button", { name: /AUnit 1\.7\.1/ })).toBeInTheDocument();
  });

  it("shows the details with include, compatibility and examples, and binds the package", async () => {
    const user = userEvent.setup();
    const props = renderDialog();

    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));
    const details = screen.getByRole("region", { name: "AUnit 1.7.1" });

    expect(within(details).getByText("#include <AUnit.h>")).toBeInTheDocument();
    expect(within(details).getByText("Brian T. Park")).toBeInTheDocument();
    expect(within(details).queryByText(/Kompilierung|Simulation \(/)).toBeNull();
    expect(within(details).getByRole("link", { name: "Dokumentation" })).toHaveAttribute("href", aunit.documentationUrl);
    await user.click(within(details).getByRole("button", { name: "Einbinden" }));
    expect(props.onInclude).toHaveBeenCalledWith(aunit);
  });

  it("names why an engine is not supported", async () => {
    const user = userEvent.setup();
    renderDialog({ runtime: "host-mock" });

    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    expect(screen.getByText("Simulation (Legacy): nicht unterstützt – No libraries in the Legacy build.")).toBeInTheDocument();
  });

  it("offers Include einfügen for a selected package and states Bereits eingebunden without a second change", async () => {
    const user = userEvent.setup();
    const selected = [{ name: "AUnit", version: "1.7.1" }];
    const props = renderDialog({ libraries: selected });
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));
    expect(screen.getByText("Im Projekt", { selector: "[data-testid=library-project-badge]" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Include einfügen" }));
    expect(props.onInsertInclude).toHaveBeenCalledWith(aunit);
  });

  it("states Bereits eingebunden as a status, not as a disabled button", async () => {
    const user = userEvent.setup();
    renderDialog({
      libraries: [{ name: "AUnit", version: "1.7.1" }],
      activeFile: { path: "sketch.ino", editable: true, content: "#include <AUnit.h>\n", localHeaders: ["sketch.ino"] },
    });
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Bereits eingebunden");
    expect(screen.queryByRole("button", { name: "Bereits eingebunden" })).toBeNull();
  });

  it("marks only the selected version as Im Projekt, another version of the same package differently", () => {
    renderDialog({ libraries: [{ name: "AUnit", version: "1.6.0" }] });

    const listed = screen.getByRole("button", { name: /AUnit 1\.7\.1/ });
    expect(within(listed).queryByText("Im Projekt")).toBeNull();
    expect(within(listed).getByText("Andere Version im Projekt")).toBeInTheDocument();
  });

  it("names the target file below the action and shows its full path on request", async () => {
    const user = userEvent.setup();
    const path = "libraries/AUnit/AUnitMinimal/AUnitMinimal.ino";
    renderDialog({ activeFile: { path, editable: true, content: "void setup(){}\n", localHeaders: [path] } });
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    const target = screen.getByText("Zieldatei:", { exact: false });
    expect(target).toHaveTextContent("Zieldatei: AUnitMinimal.ino");
    expect(screen.getByRole("button", { name: "Einbinden" }).parentElement).toHaveClass("flex-col");
    expect(screen.getByText(path)).not.toBeVisible();
    await user.click(target);
    expect(screen.getByText(path)).toBeVisible();
    expect(screen.getByText(path)).toHaveClass("break-all");
  });

  it("names a file at the top level without an expandable path", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    expect(screen.getByText("Zieldatei:", { exact: false })).toHaveTextContent("Zieldatei: sketch.ino");
    expect(screen.queryByText("sketch.ino", { selector: "p.break-all:not(:has(strong))" })).toBeNull();
  });

  it("keeps name and status of a list entry on separate lines", () => {
    renderDialog({ libraries: [{ name: "AUnit", version: "1.6.0" }] });

    const listed = screen.getByRole("button", { name: /AUnit 1\.7\.1/ });
    expect(within(listed).getByText("AUnit 1.7.1").parentElement).toBe(listed);
    expect(within(listed).getByText("Andere Version im Projekt").parentElement).toBe(listed);
  });

  it("links each view tab to its panel and keeps the selection across the views", async () => {
    const user = userEvent.setup();
    renderDialog({ libraries: [{ name: "AUnit", version: "1.7.1" }] });
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    const available = screen.getByRole("tab", { name: "Verfügbar" });
    expect(document.getElementById(available.getAttribute("aria-controls") ?? "")).toBe(screen.getByRole("tabpanel"));
    await user.click(screen.getByRole("tab", { name: "Im Projekt" }));

    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", screen.getByRole("tab", { name: "Im Projekt" }).id);
    expect(screen.getByRole("region", { name: "AUnit 1.7.1" })).toBeInTheDocument();
  });

  it("puts Einbinden before the description and the example title on a wrapping line", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    const include = screen.getByRole("button", { name: "Einbinden" });
    const description = within(screen.getByRole("region", { name: "AUnit 1.7.1" })).getByText(aunit.description);
    expect(include.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("AUnit minimal example")).toHaveClass("break-words");
    expect(screen.getByText("AUnit minimal example").parentElement).toHaveClass("flex-wrap");
  });

  it("keeps a version missing on this deployment visible, without actions", async () => {
    const user = userEvent.setup();
    renderDialog({ libraries: [{ name: "AUnit", version: "1.6.0" }] });

    await user.click(screen.getByRole("tab", { name: "Im Projekt" }));
    await user.click(screen.getByRole("button", { name: /AUnit 1\.6\.0/ }));

    expect(within(screen.getByRole("region", { name: "AUnit 1.6.0" })).getByText("Nicht verfügbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Einbinden" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Include einfügen" })).toBeNull();
  });

  it("opens the minimal example only after confirming the replacement", async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    await user.click(screen.getByRole("button", { name: "Minimalbeispiel öffnen" }));
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(props.onOpenExample).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Minimalbeispiel öffnen" }));
    await user.click(screen.getByRole("button", { name: "Ersetzen" }));
    expect(props.onOpenExample).toHaveBeenCalledWith("builtin-aunit");
  });

  it("returns the focus to Minimalbeispiel öffnen when the replacement is cancelled", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    await user.click(screen.getByRole("button", { name: "Minimalbeispiel öffnen" }));
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Minimalbeispiel öffnen" })).toHaveFocus());
  });

  it("can be operated with the keyboard", async () => {
    const user = userEvent.setup();
    const props = renderDialog();

    await user.click(screen.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }));
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: /AUnit 1\.7\.1/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "Einbinden" }).focus();
    await user.keyboard("{Enter}");
    expect(props.onInclude).toHaveBeenCalledWith(aunit);
  });
});

function renderProps(overrides: Partial<LibrariesDialogProps> = {}): LibrariesDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    boardId: "uno",
    boardName: "Arduino UNO",
    runtime: "browser",
    catalog: { status: "ready", packages: [aunit], retry: vi.fn(async () => undefined) },
    libraries: [],
    activeFile: { path: "sketch.ino", editable: true, content: "", localHeaders: ["sketch.ino"] },
    onInclude: vi.fn(),
    onInsertInclude: vi.fn(),
    onOpenExample: vi.fn(),
    ...overrides,
  };
}

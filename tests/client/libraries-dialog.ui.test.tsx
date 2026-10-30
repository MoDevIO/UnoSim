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
  it("names board and engine and lists the offered packages in one list, without views", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Libraries" })).toBeInTheDocument();
    expect(screen.getByText("Arduino UNO · Emulation")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("button", { name: /AUnit 1\.7\.1/ })).toBeInTheDocument();
    expect(screen.queryByText(/Wähle eine Bibliothek/)).toBeNull();
  });

  it("tells loading, a failed fetch with retry, an empty catalog and no hits apart", async () => {
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

    expect(within(details).queryByText(/#include/)).toBeNull();
    expect(within(details).getByText("Brian T. Park")).toBeInTheDocument();
    expect(within(details).getByText("Zieldatei:", { exact: false })).toHaveTextContent("Zieldatei: sketch.ino");
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
    expect(screen.getByText("Zieldatei:", { exact: false })).toHaveTextContent("Zieldatei: sketch.ino");
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
    // The state says it all: no target file and no second "Im Projekt" in the details; the list keeps its status.
    expect(screen.queryByText("Zieldatei:", { exact: false })).toBeNull();
    expect(screen.queryByTestId("library-project-badge")).toBeNull();
    expect(within(screen.getByRole("button", { name: /AUnit 1\.7\.1/ })).getByText("Im Projekt")).toBeInTheDocument();
  });

  it("lists an offered and a required missing version once each, marked by name and exact version", () => {
    renderDialog({ libraries: [{ name: "AUnit", version: "1.6.0" }] });

    expect(screen.getAllByRole("button", { name: /^AUnit / })).toHaveLength(2);
    const offered = screen.getByRole("button", { name: /AUnit 1\.7\.1/ });
    expect(within(offered).queryByText("Im Projekt")).toBeNull();
    expect(within(offered).queryByText("Nicht verfügbar")).toBeNull();
    const required = screen.getByRole("button", { name: /AUnit 1\.6\.0/ });
    expect(within(required).getByText("Im Projekt")).toBeInTheDocument();
    expect(within(required).getByText("Nicht verfügbar")).toBeInTheDocument();
  });

  it("marks the selected offered version as Im Projekt and lists it only once", () => {
    renderDialog({ libraries: [{ name: "AUnit", version: "1.7.1" }] });

    const [listed] = screen.getAllByRole("button", { name: /^AUnit / });
    expect(screen.getAllByRole("button", { name: /^AUnit / })).toHaveLength(1);
    expect(within(listed).getByText("Im Projekt")).toBeInTheDocument();
  });

  it("finds a required missing version by its name", async () => {
    const user = userEvent.setup();
    renderDialog({ libraries: [{ name: "Zeta", version: "1.0.0" }] });

    await user.type(screen.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }), "zeta");

    expect(screen.getAllByRole("button", { name: /Zeta 1\.0\.0/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /AUnit/ })).toBeNull();
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
    renderDialog({ libraries: [{ name: "AUnit", version: "1.7.1" }] });

    const listed = screen.getByRole("button", { name: /AUnit 1\.7\.1/ });
    expect(within(listed).getByText("AUnit 1.7.1").parentElement).toBe(listed);
    expect(within(listed).getByText("Im Projekt").parentElement?.parentElement).toBe(listed);
  });

  it("puts search and list in one column and leaves the details empty without a selection", () => {
    renderDialog();

    const search = screen.getByRole("searchbox", { name: "Bibliotheken durchsuchen" });
    const list = screen.getByRole("button", { name: /AUnit 1\.7\.1/ }).closest("ul");
    expect(search.parentElement).toContainElement(list);
    expect(search).toHaveClass("w-full");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("changes neither source nor selection by searching and selecting", async () => {
    const user = userEvent.setup();
    const props = renderDialog();

    await user.type(screen.getByRole("searchbox", { name: "Bibliotheken durchsuchen" }), "aunit");
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    expect(props.onInclude).not.toHaveBeenCalled();
    expect(props.onInsertInclude).not.toHaveBeenCalled();
    expect(props.onOpenExample).not.toHaveBeenCalled();
  });

  it("puts Einbinden before the description and shows a single example without its title", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    const include = screen.getByRole("button", { name: "Einbinden" });
    const description = within(screen.getByRole("region", { name: "AUnit 1.7.1" })).getByText(aunit.description);
    expect(include.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Minimalbeispiel öffnen" })).toBeInTheDocument();
    expect(screen.queryByText("AUnit minimal example")).toBeNull();
  });

  it("names each of several examples, wrapping, and opens the chosen one", async () => {
    const user = userEvent.setup();
    const examples = [
      aunit.examples[0],
      { title: "AUnit verbose example", path: "libraries/AUnit/AUnitVerbose/AUnitVerbose.ino", exampleId: "builtin-aunit-verbose" },
    ];
    const props = renderDialog({ catalog: { status: "ready", packages: [{ ...aunit, examples }], retry: vi.fn(async () => undefined) } });
    await user.click(screen.getByRole("button", { name: /AUnit 1\.7\.1/ }));

    const buttons = screen.getAllByRole("button", { name: "Minimalbeispiel öffnen" });
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toHaveAccessibleDescription("AUnit verbose example");
    expect(screen.getByText("AUnit minimal example")).toHaveClass("break-words");
    expect(screen.getByText("AUnit minimal example").parentElement).toHaveClass("flex-wrap");
    await user.click(buttons[1]);
    await user.click(screen.getByRole("button", { name: "Ersetzen" }));
    expect(props.onOpenExample).toHaveBeenCalledWith("builtin-aunit-verbose");
  });

  it("keeps a version missing on this deployment visible, without actions", async () => {
    const user = userEvent.setup();
    renderDialog({ libraries: [{ name: "AUnit", version: "1.6.0" }] });

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

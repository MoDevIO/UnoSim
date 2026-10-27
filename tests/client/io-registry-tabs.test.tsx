import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParserOutput } from "@/components/features/parser-output";
import { setActiveBoard } from "@/lib/active-board";
import type { IOPinRecord } from "@shared/schema";

const used: IOPinRecord = {
  pin: "4",
  defined: true,
  usedAt: [],
  pinModeModes: ["OUTPUT"],
  pinModeLocations: [{ file: "drivers/output.h", line: 23 }],
  digitalWriteLocations: [{ file: "main.ino", line: 17 }],
};
const registry = (records: IOPinRecord[] = [used], onGoToLine = vi.fn()) => (
  <ParserOutput
    messages={[]}
    ioRegistry={records}
    onClear={vi.fn()}
    onGoToLine={onGoToLine}
    defaultTab="registry"
  />
);
afterEach(() => setActiveBoard("uno"));

describe("I/O Registry views", () => {
  it("opens on programmed pins and exposes all pins through a tab", async () => {
    const user = userEvent.setup();
    render(registry());
    expect(
      screen.getByRole("tab", { name: "Programmed Pins (1)" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    await user.click(
      screen.getByRole("tab", { name: "All Pins", exact: true }),
    );
    expect(document.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(screen.getByText("OUTPUT")).toBeVisible();
  });

  it("keeps file-aware source targets and detail state through all three views", async () => {
    const user = userEvent.setup(),
      navigate = vi.fn();
    render(registry([used], navigate));
    await user.click(
      screen.getByRole("button", { name: "Show source locations" }),
    );
    for (const name of ["All Pins", "Pin Infos", "Programmed Pins (1)"]) {
      await user.click(screen.getByRole("tab", { name, exact: true }));
      if (name === "Pin Infos") {
        expect(
          screen.queryByRole("button", { name: "Hide source locations" }),
        ).not.toBeInTheDocument();
      } else {
        const location = screen.getByRole("button", {
          name: "Go to drivers/output.h:23",
        });
        expect(location).toHaveTextContent("output.h:23");
        await user.click(location);
        expect(navigate).toHaveBeenLastCalledWith({
          file: "drivers/output.h",
          line: 23,
        });
        expect(
          screen.getByRole("button", { name: "Go to main.ino:17" }),
        ).toBeVisible();
      }
    }
  });

  it("offers Pin Infos and All Pins without a programmed pin", async () => {
    const user = userEvent.setup();
    render(registry([]));
    expect(
      screen.getByRole("tab", { name: "Programmed Pins (0)" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("tab", { name: "Pin Infos", exact: true }),
    );
    expect(
      screen.getByRole("columnheader", { name: "Bus Connections" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("tab", { name: "All Pins", exact: true }),
    );
    expect(document.querySelectorAll("tbody tr")).toHaveLength(20);
  });

  it("updates the programmed count and retains runtime provenance after tab changes", async () => {
    const user = userEvent.setup(),
      view = render(registry());
    await user.click(
      screen.getByRole("tab", { name: "Pin Infos", exact: true }),
    );
    view.rerender(
      registry([
        used,
        {
          pin: "12",
          defined: false,
          usedAt: [{ line: 0, operation: "digitalRead" }],
          origin: { digitalRead: "runtime" },
        },
      ]),
    );
    await user.click(screen.getByRole("tab", { name: "Programmed Pins (2)" }));
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    await user.click(
      screen.getByRole("button", { name: "Show source locations" }),
    );
    expect(within(rows[2]).getByText("runtime")).toBeVisible();
  });
  it("updates an open reference and All Pins when only the board prop changes", async () => {
    const user = userEvent.setup();
    const view = render(
      <ParserOutput
        messages={[]}
        ioRegistry={[]}
        onClear={vi.fn()}
        defaultTab="registry"
        boardId="uno"
      />,
    );
    await user.click(
      screen.getByRole("tab", { name: "Pin Infos", exact: true }),
    );
    view.rerender(
      <ParserOutput
        messages={[]}
        ioRegistry={[]}
        onClear={vi.fn()}
        defaultTab="registry"
        boardId="mega2560"
      />,
    );
    expect(screen.queryByText("D69")).not.toBeInTheDocument();
    expect(screen.getByText("A15")).toBeVisible();
    await user.click(
      screen.getByRole("tab", { name: "All Pins", exact: true }),
    );
    expect(document.querySelectorAll("tbody tr")).toHaveLength(70);
    view.rerender(
      <ParserOutput
        messages={[]}
        ioRegistry={[]}
        onClear={vi.fn()}
        defaultTab="registry"
        boardId="attiny85"
      />,
    );
    expect(document.querySelectorAll("tbody tr")).toHaveLength(6);
  });
  it.each([
    ["attiny85", "0", "TX"],
    ["attiny85", "1", "RX"],
    ["mega2560", "14", "TX"],
    ["mega2560", "19", "RX"],
  ] as const)(
    "uses %s pin %s's real Serial direction in the usage table",
    (boardId, pin, direction) => {
      render(
        <ParserOutput
          boardId={boardId}
          messages={[]}
          ioRegistry={[
            {
              pin,
              defined: true,
              usedAt: [{ line: 1, operation: "pinMode:1" }],
            },
          ]}
          onClear={vi.fn()}
          defaultTab="registry"
        />,
      );
      const pinCell = screen.getAllByRole("cell")[0];
      expect(within(pinCell).getByText(direction)).toBeVisible();
    },
  );

  it("uses the supplied board for PWM labels even if the ambient board is still Uno", () => {
    setActiveBoard("uno");
    render(
      <ParserOutput
        boardId="attiny85"
        messages={[]}
        ioRegistry={[
          {
            pin: "4",
            defined: true,
            usedAt: [{ line: 1, operation: "analogWrite" }],
          },
        ]}
        onClear={vi.fn()}
        defaultTab="registry"
      />,
    );
    expect(within(screen.getAllByRole("cell")[0]).getByText("~")).toBeVisible();
  });
});

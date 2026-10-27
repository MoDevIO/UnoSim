import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PinInfos } from "@/components/features/pin-infos";

const row = (label: string) =>
  screen.getByRole("row", {
    name: new RegExp(
      "^" + label.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + "(?: |$)",
    ),
  });

describe("Pin Infos", () => {
  it("uses one header row and groups every bus role in one column", () => {
    render(<PinInfos boardId="attiny85" />);
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual([
      "Pin",
      "Digital In",
      "Digital Out",
      "Analog In",
      "PWM Out",
      "Bus Connections",
      "Ext. IRQ",
      "Pin Change",
      "Timer",
    ]);
    expect(document.querySelectorAll("thead tr")).toHaveLength(1);
    const cells = within(row("PB0")).getAllByRole("cell");
    expect(cells[5]).toHaveTextContent("USI / I²C · SDA");
    expect(cells[5]).toHaveTextContent("USI / SPI (master) · MISO");
    expect(cells[5]).toHaveTextContent("Software Serial · TX");
    expect(cells[0]).toHaveTextContent("Code: 0");
    expect(row("PB4")).toHaveTextContent("Code: 4 / A2");
  });

  it("never marks analog-only Nano A6/A7 as digital, PWM or interrupt pins", () => {
    render(<PinInfos boardId="nano" />);
    for (const label of ["A6", "A7"]) {
      const cells = within(row(label)).getAllByRole("cell");
      expect(cells[1]).toHaveTextContent("—");
      expect(cells[2]).toHaveTextContent("—");
      expect(cells[3]).toHaveTextContent("10 Bit");
      expect(cells[4]).toHaveTextContent("—");
      expect(cells[6]).toHaveTextContent("—");
      expect(cells[7]).toHaveTextContent("—");
    }
  });

  it("keeps RESET and limited PCINT helper support explicit", () => {
    const view = render(<PinInfos boardId="attiny85" />);
    const reset = within(row("PB5")).getAllByRole("cell");
    expect(reset[1]).toHaveTextContent("RESET *");
    expect(reset[2]).toHaveTextContent("RESET *");
    expect(within(reset[1]).getByTitle(/RESET.*reserved/i)).toBeVisible();
    view.rerender(<PinInfos boardId="mega2560" />);
    expect(within(row("D14")).getByText("PCINT10 *")).toHaveAttribute(
      "title",
      expect.stringContaining("core helpers"),
    );
  });

  it("searches by bus role with either I2C spelling, without losing shared pins", async () => {
    const user = userEvent.setup();
    render(<PinInfos boardId="uno" />);
    const search = screen.getByRole("searchbox", {
      name: "Search pins or functions",
    });
    await user.type(search, "I2C");
    expect(row("A4")).toBeVisible();
    expect(row("A5")).toBeVisible();
    expect(screen.queryByRole("row", { name: /^D0 / })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "MOSI");
    expect(row("D11")).toBeVisible();
    await user.clear(search);
    await user.type(search, "zzmissing");
    expect(screen.getByText("No matching pins.")).toBeVisible();
  });

  it("resets a board-specific search and updates the reference when the board changes", async () => {
    const user = userEvent.setup(),
      view = render(<PinInfos boardId="uno" />);
    await user.type(screen.getByRole("searchbox"), "A5");
    view.rerender(<PinInfos boardId="attiny85" />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(row("PB4")).toBeVisible();
    expect(screen.queryByRole("row", { name: /^A5 / })).not.toBeInTheDocument();
  });

  it("labels power contacts as reference-only without adding programmable pin numbers", () => {
    render(<PinInfos boardId="uno" />);
    expect(row("GND")).toHaveTextContent("Ground");
    expect(
      within(row("5V"))
        .getAllByRole("cell")
        .slice(1)
        .every((cell) => cell.textContent === "—"),
    ).toBe(true);
    expect(screen.getByText(/reference only/i)).toBeVisible();
    expect(
      screen.getAllByTitle(
        "Hardware capability; this peripheral is not simulated.",
      ).length,
    ).toBeGreaterThan(0);
  });
});

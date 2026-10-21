import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SerialMonitorView } from "@/components/simulator/SerialMonitorView";

function renderView(props: { serialPort?: number; serialPortCount?: number; setSerialPort?: (port: number) => void }) {
  return render(
    <SerialMonitorView
      renderedSerialOutput={[]}
      serialOutput={[]}
      isConnected
      simulationStatus="running"
      handleSerialSend={vi.fn()}
      handleClearSerialOutput={vi.fn()}
      showSerialMonitor
      showSerialPlotter={false}
      serialViewMode="monitor"
      cycleSerialViewMode={vi.fn()}
      autoScrollEnabled
      setAutoScrollEnabled={vi.fn()}
      serialInputValue=""
      setSerialInputValue={vi.fn()}
      handleSerialInputKeyDown={vi.fn()}
      handleSerialInputSend={vi.fn()}
      debugMode={false}
      telemetryData={{ last: null }}
      baudRate={9600}
      {...props}
    />,
  );
}

describe("serial port selector (plan P5.3)", () => {
  it("is absent on a board with one serial port", () => {
    renderView({ serialPortCount: 1, setSerialPort: vi.fn() });

    expect(screen.queryByTestId("serial-port-selector")).toBeNull();
    expect(screen.getByPlaceholderText("Send to Arduino...")).toBeTruthy();
  });

  it("offers Serial to Serial3 on the Mega and marks the shown one", () => {
    renderView({ serialPort: 2, serialPortCount: 4, setSerialPort: vi.fn() });

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Serial", "Serial1", "Serial2", "Serial3"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false"]);
  });

  it("selects a port on click and names it in the input placeholder", async () => {
    const user = userEvent.setup();
    const setSerialPort = vi.fn();
    renderView({ serialPort: 3, serialPortCount: 4, setSerialPort });

    await user.click(screen.getByTestId("serial-port-1"));

    expect(setSerialPort).toHaveBeenCalledWith(1);
    expect(screen.getByPlaceholderText("Send to Serial3...")).toBeTruthy();
  });
});

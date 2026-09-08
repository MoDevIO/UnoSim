import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PinMonitor } from "@/components/features/pin-monitor";

describe("PinMonitor", () => {
  it("keeps pin values visible without rendering performance diagnostics", () => {
    render(
      <PinMonitor
        pinStates={[
          { pin: 13, mode: "OUTPUT", value: 1, type: "digital" },
          { pin: 3, mode: "OUTPUT", value: 128, type: "pwm" },
        ]}
      />,
    );

    expect(screen.getByText("Pin 3")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("Pin 13")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.queryByText("Show FPS")).not.toBeInTheDocument();
    expect(screen.queryByText("Hide FPS")).not.toBeInTheDocument();
    expect(screen.queryByText(/Batch ms:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last batch size:/)).not.toBeInTheDocument();
  });
});

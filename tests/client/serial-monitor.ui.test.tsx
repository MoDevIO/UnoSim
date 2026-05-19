import { render, screen, waitFor } from "@testing-library/react";
import { SerialMonitor, applyBackspaceAcrossLines } from "@/components/features/serial-monitor";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("SerialMonitor UI", () => {
  const baseProps = {
    isConnected: true,
    isSimulationRunning: true,
    onSendMessage: vi.fn(),
    onClear: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays the Serial frame and renders placeholder without output", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        autoScrollEnabled
        output={[]}
      />,
    );

    expect(screen.getByTestId("serial-output")).not.toBeNull();
    expect(await screen.findByText("Serial output will appear here...")).not.toBeNull();
  });

  it("hides the Serial frame when showMonitor=false is set", () => {
    render(<SerialMonitor {...baseProps} showMonitor={false} output={[]} />);

    expect(screen.queryByTestId("serial-output")).toBeNull();
  });

  it("displays received Serial text in the frame", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "Hello World!", complete: true }]}
      />,
    );

    expect(await screen.findByText("Hello World!")).not.toBeNull();
  });

  it("renders multiple output lines", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[
          { text: "Line 1", complete: true },
          { text: "Line 2", complete: true },
          { text: "Line 3", complete: true },
        ]}
      />,
    );

    expect(await screen.findByText("Line 1")).not.toBeNull();
    expect(screen.getByText("Line 2")).not.toBeNull();
    expect(screen.getByText("Line 3")).not.toBeNull();
  });

  it("processes ANSI color codes and strips them", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "\x1b[31mRed Text\x1b[0m", complete: true }]}
      />,
    );

    expect(await screen.findByText("Red Text")).not.toBeNull();
  });

  it("processes clear screen ANSI code", async () => {
    const { rerender } = render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[
          { text: "Line 1", complete: true },
          { text: "Line 2", complete: true },
        ]}
      />,
    );

    expect(await screen.findByText("Line 1")).not.toBeNull();

    rerender(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[
          { text: "Line 1", complete: true },
          { text: "Line 2", complete: true },
          { text: "\x1b[2JCleared", complete: true },
        ]}
      />,
    );

    // Wait for effect to re-render before checking cleared state
    expect(await screen.findByText("Cleared")).not.toBeNull();
    expect(screen.queryByText("Line 1")).toBeNull();
    expect(screen.queryByText("Line 2")).toBeNull();
  });

  it("processes cursor home ANSI code", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[
          { text: "Line 1", complete: true },
          { text: "\x1b[2J\x1b[H", complete: true },
          { text: "After clear", complete: true },
        ]}
      />,
    );

    expect(screen.queryByText("Line 1")).toBeNull();
    expect(await screen.findByText("After clear")).not.toBeNull();
  });

  it("expands tab characters to 4 spaces", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "A\tB", complete: true }]}
      />,
    );

    const output = screen.getByTestId("serial-output");
    await waitFor(() => expect(output.textContent).toContain("A    B"));
  });

  it("strips bell character without visible marker", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "Bell\x07End", complete: true }]}
      />,
    );

    expect(await screen.findByText("BellEnd")).not.toBeNull();
  });

  it("normalizes form feed to newline", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "Line1\fLine2", complete: true }]}
      />,
    );

    const output = screen.getByTestId("serial-output");
    await waitFor(() => {
      expect(output.textContent).toContain("Line1");
      expect(output.textContent).toContain("Line2");
    });
  });

  it("normalizes vertical tab to newline", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "Line1\vLine2", complete: true }]}
      />,
    );

    const output = screen.getByTestId("serial-output");
    await waitFor(() => {
      expect(output.textContent).toContain("Line1");
      expect(output.textContent).toContain("Line2");
    });
  });

  it("handles carriage return within same line", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "Hello\rWorld", complete: true }]}
      />,
    );

    expect(await screen.findByText("World")).not.toBeNull();
    expect(screen.queryByText("Hello")).toBeNull();
  });

  it("processes CSI clear line code", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "Text\x1b[KAfter", complete: true }]}
      />,
    );

    expect(await screen.findByText("TextAfter")).not.toBeNull();
  });

  it("handles backspace within same chunk", async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: "ABC\b\bXY", complete: true }]}
      />,
    );

    expect(await screen.findByText("AXY")).not.toBeNull();
  });

  it("disables autoscroll when autoScrollEnabled is false", () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        autoScrollEnabled={false}
        output={[{ text: "Test", complete: true }]}
      />,
    );

    const output = screen.getByTestId("serial-output");
    expect(output).not.toBeNull();
    // AutoScroll is disabled, scrollTop should remain 0
    expect(output.scrollTop).toBe(0);
  });

  it("renders with default prop values", () => {
    render(
      <SerialMonitor
        isConnected={true}
        isSimulationRunning={false}
        onSendMessage={vi.fn()}
        onClear={vi.fn()}
        output={[]}
      />,
    );

    expect(screen.getByTestId("serial-output")).not.toBeNull();
  });

  it("renders serial-monitor container with testid", () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[]}
      />,
    );

    expect(screen.getByTestId("serial-monitor")).not.toBeNull();
  });
});

describe("applyBackspaceAcrossLines", () => {
  it("returns text unchanged when no backspace present", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [];
    const result = applyBackspaceAcrossLines(lines, "Hello", true);
    expect(result).toBe("Hello");
  });

  it("removes characters from previous incomplete line with leading backspace and appends rest", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "Hello", incomplete: true },
    ];
    const result = applyBackspaceAcrossLines(lines, "\b\bWorld", true);
    expect(lines[0].text).toBe("HelWorld");
    expect(lines[0].incomplete).toBe(false);
    expect(result).toBeNull();
  });

  it("appends to last incomplete line when text remains", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "Hello", incomplete: true },
    ];
    const result = applyBackspaceAcrossLines(lines, " World", true);
    expect(result).toBeNull();
    expect(lines[0].text).toContain("Hello World");
  });

  it("returns null when all text consumed by backspace", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "Hello", incomplete: true },
    ];
    const result = applyBackspaceAcrossLines(lines, "\b\b\b\b\b", true);
    expect(lines[0].text).toBe("");
    expect(result).toBeNull();
  });

  it("returns text when no incomplete line to append to", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "Complete line", incomplete: false },
    ];
    const result = applyBackspaceAcrossLines(lines, "New text", true);
    expect(result).toBe("New text");
  });

  it("handles multiple leading backspaces and appends rest", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "ABCDEF", incomplete: true },
    ];
    const result = applyBackspaceAcrossLines(lines, "\b\b\b\bXY", true);
    expect(lines[0].text).toBe("ABXY");
    expect(lines[0].incomplete).toBe(false);
    expect(result).toBeNull();
  });

  it("marks line as complete when isComplete is true", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "Hello", incomplete: true },
    ];
    applyBackspaceAcrossLines(lines, " World", true);
    expect(lines[0].incomplete).toBe(false);
  });

  it("marks line as incomplete when isComplete is false", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "Hello", incomplete: true },
    ];
    applyBackspaceAcrossLines(lines, " World", false);
    expect(lines[0].incomplete).toBe(true);
  });

  it("strips ANSI codes when appending to incomplete line", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "Hello", incomplete: true },
    ];
    const result = applyBackspaceAcrossLines(lines, "\x1b[31m World\x1b[0m", true);
    expect(result).toBeNull();
    expect(lines[0].text).toContain(" World");
    expect(lines[0].text).not.toContain("\x1b");
  });

  it("returns text with backspaces when no incomplete line exists", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [];
    const result = applyBackspaceAcrossLines(lines, "\b\bHello", true);
    expect(result).toBe("\b\bHello");
    expect(lines.length).toBe(0);
  });

  it("processes backspaces in middle of text via processAnsiCodes", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "ABC", incomplete: true },
    ];
    const result = applyBackspaceAcrossLines(lines, "\bX\bY", true);
    // First backspace removes C → "AB", then "X\bY" is processed by processAnsiCodes
    // processAnsiCodes handles \b within text: "X" + "\b" removes one char, then "Y" → result is "Y"
    expect(lines[0].text).toBe("ABY");
    expect(result).toBeNull();
  });

  it("handles empty text after backspace removal", () => {
    const lines: Array<{ text: string; incomplete: boolean }> = [
      { text: "AB", incomplete: true },
    ];
    const result = applyBackspaceAcrossLines(lines, "\b\b", true);
    expect(lines[0].text).toBe("");
    expect(result).toBeNull();
  });
});

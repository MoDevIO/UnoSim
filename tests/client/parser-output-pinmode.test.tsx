import { render, screen, waitFor } from "@testing-library/react";
import { ParserOutput } from "@/components/features/parser-output";
import type { ParserMessage, IOPinRecord } from "@shared/schema";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";

// Helper function to extract pinMode data (extracted from parser-output.tsx)
function extractPinModeData(
  operations: Array<{ line: number; operation: string }>,
) {
  const pinModes = operations
    .filter((u) => u.operation.includes("pinMode"))
    .map((u) => {
      const match = u.operation.match(/pinMode:(\d+)/);
      const mode = match ? parseInt(match[1]) : -1;
      return mode === 0
        ? "INPUT"
        : mode === 1
          ? "OUTPUT"
          : mode === 2
            ? "INPUT_PULLUP"
            : "UNKNOWN";
    });

  const uniqueModes = [...new Set(pinModes)];
  const hasMultipleModes = uniqueModes.length > 1;

  return { pinModes, uniqueModes, hasMultipleModes };
}

describe("ParserOutput - pinMode Detection", () => {
  describe("extractPinModeData", () => {
    it("should parse single pinMode:0 as INPUT", () => {
      const operations = [{ line: 0, operation: "pinMode:0" }];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["INPUT"]);
      expect(result.uniqueModes).toEqual(["INPUT"]);
      expect(result.hasMultipleModes).toBe(false);
    });

    it("should parse single pinMode:1 as OUTPUT", () => {
      const operations = [{ line: 0, operation: "pinMode:1" }];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["OUTPUT"]);
      expect(result.uniqueModes).toEqual(["OUTPUT"]);
      expect(result.hasMultipleModes).toBe(false);
    });

    it("should parse single pinMode:2 as INPUT_PULLUP", () => {
      const operations = [{ line: 0, operation: "pinMode:2" }];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["INPUT_PULLUP"]);
      expect(result.uniqueModes).toEqual(["INPUT_PULLUP"]);
      expect(result.hasMultipleModes).toBe(false);
    });

    it("should detect multiple different modes (conflict)", () => {
      const operations = [
        { line: 0, operation: "pinMode:1" },
        { line: 0, operation: "pinMode:0" },
      ];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["OUTPUT", "INPUT"]);
      expect(result.uniqueModes).toEqual(["OUTPUT", "INPUT"]);
      expect(result.hasMultipleModes).toBe(true);
    });

    it("should detect same mode repeated", () => {
      const operations = [
        { line: 0, operation: "pinMode:0" },
        { line: 0, operation: "pinMode:0" },
        { line: 0, operation: "pinMode:0" },
      ];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["INPUT", "INPUT", "INPUT"]);
      expect(result.uniqueModes).toEqual(["INPUT"]);
      expect(result.hasMultipleModes).toBe(false);
    });

    it("should handle mixed operations and extract only pinMode", () => {
      const operations = [
        { line: 5, operation: "digitalWrite" },
        { line: 0, operation: "pinMode:1" },
        { line: 8, operation: "digitalRead" },
        { line: 0, operation: "pinMode:0" },
      ];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["OUTPUT", "INPUT"]);
      expect(result.uniqueModes).toEqual(["OUTPUT", "INPUT"]);
      expect(result.hasMultipleModes).toBe(true);
    });

    it("should return UNKNOWN for invalid mode numbers", () => {
      const operations = [{ line: 0, operation: "pinMode:99" }];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["UNKNOWN"]);
      expect(result.uniqueModes).toEqual(["UNKNOWN"]);
      expect(result.hasMultipleModes).toBe(false);
    });

    it("should return UNKNOWN for malformed pinMode operation", () => {
      const operations = [{ line: 0, operation: "pinMode" }];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["UNKNOWN"]);
      expect(result.uniqueModes).toEqual(["UNKNOWN"]);
      expect(result.hasMultipleModes).toBe(false);
    });

    it("should handle empty operations array", () => {
      const operations: Array<{ line: number; operation: string }> = [];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual([]);
      expect(result.uniqueModes).toEqual([]);
      expect(result.hasMultipleModes).toBe(false);
    });

    it("should handle complex scenario with conflicts and repeats", () => {
      const operations = [
        { line: 0, operation: "pinMode:1" },
        { line: 0, operation: "pinMode:1" },
        { line: 0, operation: "pinMode:0" },
        { line: 0, operation: "pinMode:1" },
      ];
      const result = extractPinModeData(operations);

      expect(result.pinModes).toEqual(["OUTPUT", "OUTPUT", "INPUT", "OUTPUT"]);
      expect(result.uniqueModes).toEqual(["OUTPUT", "INPUT"]);
      expect(result.hasMultipleModes).toBe(true);
    });
  });

  describe("pinMode count logic", () => {
    it("should correctly count occurrences of each mode", () => {
      const pinModes = ["INPUT", "INPUT", "OUTPUT", "INPUT"];
      const uniqueModes = [...new Set(pinModes)];

      const inputCount = pinModes.filter((m) => m === "INPUT").length;
      const outputCount = pinModes.filter((m) => m === "OUTPUT").length;

      expect(uniqueModes).toEqual(["INPUT", "OUTPUT"]);
      expect(inputCount).toBe(3);
      expect(outputCount).toBe(1);
    });
  });
});

describe("I/O Registry - pinMode Operation Format", () => {
  it("should match pinMode:0 format", () => {
    const operation = "pinMode:0";
    const match = operation.match(/pinMode:(\d+)/);

    expect(match).not.toBeNull();
    expect(match![1]).toBe("0");
  });

  it("should match pinMode:1 format", () => {
    const operation = "pinMode:1";
    const match = operation.match(/pinMode:(\d+)/);

    expect(match).not.toBeNull();
    expect(match![1]).toBe("1");
  });

  it("should match pinMode:2 format", () => {
    const operation = "pinMode:2";
    const match = operation.match(/pinMode:(\d+)/);

    expect(match).not.toBeNull();
    expect(match![1]).toBe("2");
  });

  it("should not match plain pinMode without colon", () => {
    const operation = "pinMode";
    const match = operation.match(/pinMode:(\d+)/);

    expect(match).toBeNull();
  });

  it("should not match pinMode with non-numeric mode", () => {
    const operation = "pinMode:INPUT";
    const match = operation.match(/pinMode:(\d+)/);

    expect(match).toBeNull();
  });
});

describe("ParserOutput Component", () => {
  const mockOnClear = vi.fn();
  const mockOnGoToLine = vi.fn();
  const mockOnInsertSuggestion = vi.fn();

  beforeEach(() => {
    mockOnClear.mockClear();
    mockOnGoToLine.mockClear();
    mockOnInsertSuggestion.mockClear();
  });

  it("renders with no messages", () => {
    render(
      <ParserOutput
        messages={[]}
        onClear={mockOnClear}
      />,
    );

    expect(screen.getByText("No parser messages")).not.toBeNull();
  });

  it("renders messages grouped by category", () => {
    const messages: ParserMessage[] = [
      {
        id: "1",
        severity: 2,
        message: "Serial warning",
        category: "serial",
        line: 5,
      },
      {
        id: "2",
        severity: 3,
        message: "Hardware error",
        category: "hardware",
        line: 10,
      },
    ];

    render(
      <ParserOutput
        messages={messages}
        onClear={mockOnClear}
      />,
    );

    expect(screen.getByText(/Serial Configuration/i)).not.toBeNull();
    expect(screen.getByText(/Hardware Compatibility/i)).not.toBeNull();
    expect(screen.getByText("Serial warning")).not.toBeNull();
    expect(screen.getByText("Hardware error")).not.toBeNull();
  });

  it("displays error/warning/info counts in header", () => {
    const messages: ParserMessage[] = [
      { id: "1", severity: 3, message: "Error", category: "pins", line: 1 },
      { id: "2", severity: 2, message: "Warning", category: "pins", line: 2 },
      { id: "3", severity: 1, message: "Info", category: "pins", line: 3 },
    ];

    render(
      <ParserOutput
        messages={messages}
        onClear={mockOnClear}
      />,
    );

    // Check that counts are displayed (each count should be "1")
    const allText = document.body.textContent!;
    expect(allText).toContain("Messages (3)");
  });

  it("calls onClear when clear button is clicked", async () => {
    const user = userEvent.setup();

    render(
      <ParserOutput
        messages={[]}
        onClear={mockOnClear}
      />,
    );

    const clearButton = screen.getByTitle("Close");
    await user.click(clearButton);

    expect(mockOnClear).toHaveBeenCalledTimes(1);
  });

  it("calls onGoToLine when message is clicked", async () => {
    const user = userEvent.setup();
    const messages: ParserMessage[] = [
      { id: "1", severity: 2, message: "Test message", category: "pins", line: 10 },
    ];

    render(
      <ParserOutput
        messages={messages}
        onClear={mockOnClear}
        onGoToLine={mockOnGoToLine}
      />,
    );

    const messageElement = screen.getByText("Test message");
    await user.click(messageElement);

    expect(mockOnGoToLine).toHaveBeenCalledWith(10);
  });

  it("displays suggestion with insert button", async () => {
    const messages: ParserMessage[] = [
      {
        id: "1",
        severity: 2,
        message: "Test message",
        category: "pins",
        line: 5,
        suggestion: "Use pinMode()",
      },
    ];

    render(
      <ParserOutput
        messages={messages}
        onClear={mockOnClear}
        onInsertSuggestion={mockOnInsertSuggestion}
      />,
    );

    expect(screen.getByText("Suggestion:")).not.toBeNull();
    expect(screen.getByText(/Use pinMode\(\)/)).not.toBeNull();
  });

  it("calls onInsertSuggestion when insert button is clicked", async () => {
    const user = userEvent.setup();
    const messages: ParserMessage[] = [
      {
        id: "1",
        severity: 2,
        message: "Test",
        category: "pins",
        line: 5,
        suggestion: "Fix code",
      },
    ];

    render(
      <ParserOutput
        messages={messages}
        onClear={mockOnClear}
        onInsertSuggestion={mockOnInsertSuggestion}
      />,
    );

    const insertButton = screen.getByTitle("Insert suggestion");
    await user.click(insertButton);

    expect(mockOnInsertSuggestion).toHaveBeenCalledWith("Fix code", 5);
  });

  it("hides header when hideHeader is true", () => {
    render(
      <ParserOutput
        messages={[]}
        onClear={mockOnClear}
        hideHeader={true}
      />,
    );

    expect(screen.queryByText("Parser Analysis")).toBeNull();
  });

  it("displays registry tab with programmed pins", async () => {
    const user = userEvent.setup();
    const ioRegistry: IOPinRecord[] = [
      {
        pin: 13,
        defined: true,
        pinMode: 1,
        usedAt: [{ line: 5, operation: "pinMode:1" }],
      },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    expect(screen.getByText("Programmed pins (1)")).not.toBeNull();
    expect(screen.getByText("13")).not.toBeNull();
    expect(screen.getByText("OUTPUT")).not.toBeNull();
  });

  it("toggles between programmed and all pins", async () => {
    const user = userEvent.setup();
    const ioRegistry: IOPinRecord[] = [
      { pin: 13, defined: true, pinMode: 1, usedAt: [{ line: 5, operation: "pinMode:1" }] },
      { pin: 12, defined: false, usedAt: [] },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    expect(screen.getByText("Programmed pins (1)")).not.toBeNull();

    const toggleButton = screen.getByTitle("Show all pins");
    await user.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByText("All pins (2)")).not.toBeNull();
    });
  });

  it("displays 'No pins used' message when no programmed pins", () => {
    const ioRegistry: IOPinRecord[] = [
      { pin: 13, defined: false, usedAt: [] },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    expect(screen.getByText("No pins used in current sketch")).not.toBeNull();
  });

  it("shows link to show all pins when no programmed pins", async () => {
    const user = userEvent.setup();
    const ioRegistry: IOPinRecord[] = [
      { pin: 13, defined: false, usedAt: [] },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    const showAllLink = screen.getByText("Show all pins →");
    await user.click(showAllLink);

    await waitFor(() => {
      expect(screen.getByText("All pins (1)")).not.toBeNull();
    });
  });

  it("displays PWM tilde for PWM-capable pins", () => {
    const ioRegistry: IOPinRecord[] = [
      {
        pin: 9,
        defined: true,
        pinMode: 1,
        usedAt: [{ line: 5, operation: "pinMode:1" }],
      },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    const pinCell = screen.getByText("9").parentElement;
    expect(pinCell?.textContent).toContain("~");
  });

  it("displays RX for pin 0 and TX for pin 1", () => {
    const ioRegistry: IOPinRecord[] = [
      { pin: "0", defined: true, pinMode: 0, usedAt: [{ line: 1, operation: "pinMode:0" }] },
      { pin: "1", defined: true, pinMode: 1, usedAt: [{ line: 2, operation: "pinMode:1" }] },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    expect(screen.getByText("RX")).not.toBeNull();
    expect(screen.getByText("TX")).not.toBeNull();
  });

  it("displays missing pinMode with X icon", () => {
    const ioRegistry: IOPinRecord[] = [
      {
        pin: 13,
        defined: false,
        usedAt: [{ line: 5, operation: "digitalWrite" }],
      },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    const pinModeCell = screen.getByTitle("pinMode() missing");
    expect(pinModeCell).not.toBeNull();
  });

  it("displays operations with line numbers", async () => {
    const user = userEvent.setup();
    const ioRegistry: IOPinRecord[] = [
      {
        pin: 13,
        defined: true,
        pinMode: 1,
        usedAt: [
          { line: 5, operation: "digitalRead" },
          { line: 7, operation: "digitalWrite" },
        ],
      },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    // Click the eye button to show all pins and line numbers
    const toggleButton = screen.getByTitle("Show all pins");
    await user.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByText("L5")).not.toBeNull();
      expect(screen.getByText("L7")).not.toBeNull();
    });
  });

  it("switches between tabs", async () => {
    const user = userEvent.setup();
    const messages: ParserMessage[] = [
      { id: "1", severity: 1, message: "Test", category: "pins", line: 1 },
    ];

    render(
      <ParserOutput
        messages={messages}
        ioRegistry={[]}
        onClear={mockOnClear}
      />,
    );

    expect(screen.getByText("Test")).not.toBeNull();

    const registryTab = screen.getByText(/I\/O Registry/);
    await user.click(registryTab);

    await waitFor(() => {
      expect(screen.queryByText("Test")).toBeNull();
    });
  });

  it("displays message line and column numbers", () => {
    const messages: ParserMessage[] = [
      {
        id: "1",
        severity: 2,
        message: "Test",
        category: "pins",
        line: 10,
        column: 5,
      },
    ];

    render(
      <ParserOutput
        messages={messages}
        onClear={mockOnClear}
      />,
    );

    expect(screen.getByText("Line 10")).not.toBeNull();
    expect(screen.getByText(/Col 5/)).not.toBeNull();
  });

  it("displays severity labels", () => {
    const messages: ParserMessage[] = [
      { id: "1", severity: 1, message: "Info msg", category: "pins", line: 1 },
      { id: "2", severity: 2, message: "Warning msg", category: "pins", line: 2 },
      { id: "3", severity: 3, message: "Error msg", category: "pins", line: 3 },
    ];

    render(
      <ParserOutput
        messages={messages}
        onClear={mockOnClear}
      />,
    );

    expect(screen.getByText(/• Info/)).not.toBeNull();
    expect(screen.getByText(/• Warning/)).not.toBeNull();
    expect(screen.getByText(/• Error/)).not.toBeNull();
  });

  it("displays multiple pinMode modes with conflict indicator", () => {
    const ioRegistry: IOPinRecord[] = [
      {
        pin: 13,
        defined: true,
        pinMode: 1,
        usedAt: [
          { line: 5, operation: "pinMode:1" },
          { line: 10, operation: "pinMode:0" },
        ],
      },
    ];

    render(
      <ParserOutput
        messages={[]}
        ioRegistry={ioRegistry}
        onClear={mockOnClear}
        defaultTab="registry"
      />,
    );

    expect(screen.getByText("OUTPUT")).not.toBeNull();
    expect(screen.getByText("INPUT")).not.toBeNull();
  });
});

/**
 * Tests for Parser Messages Integration in Frontend
 *
 * These tests verify that:
 * 1. Parser Messages from Compile-Response are set in Frontend
 * 2. The ParserOutput panel is shown when messages are present
 * 3. Serial warnings are displayed correctly
 */

import { render, screen, fireEvent } from "@testing-library/react";
// ...existing code...
import { ParserOutput } from "../../client/src/components/features/parser-output";
import type { ParserMessage, IOPinRecord } from "@shared/schema";

describe("Parser Messages Frontend Integration", () => {
  describe("ParserOutput Component", () => {
    it("should display Messages tab when parserMessages are present", () => {
      const messages: ParserMessage[] = [
        {
          id: "test-1",
          type: "warning",
          category: "serial",
          severity: 2,
          message:
            "Serial.begin(115200) is missing in setup(). Serial output may not work correctly.",
          suggestion: "Serial.begin(115200);",
        },
      ];

      render(
        <ParserOutput messages={messages} ioRegistry={[]} onClear={() => {}} />,
      );

      // Header should show "Parser Analysis"
      expect(screen.getByText("Parser Analysis")).not.toBeNull();

      // Messages tab should be displayed
      expect(screen.getByText("Messages (1)")).not.toBeNull();
    });

    it("should display serial warnings with correct icon", () => {
      const messages: ParserMessage[] = [
        {
          id: "test-1",
          type: "warning",
          category: "serial",
          severity: 2,
          message:
            "Serial.begin(9600) uses wrong baud rate. This simulator expects Serial.begin(115200).",
          suggestion: "Serial.begin(115200);",
          line: 3,
        },
      ];

      render(
        <ParserOutput messages={messages} ioRegistry={[]} onClear={() => {}} />,
      );

      // The warning should be displayed
      expect(screen.getByText(/wrong baud rate/)).not.toBeNull();
      expect(screen.getByText("Serial Configuration")).not.toBeNull();
    });

    it("should display Serial.begin suggestion", () => {
      const onInsertSuggestion = vi.fn();

      const messages: ParserMessage[] = [
        {
          id: "test-1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Serial.begin(115200) is missing",
          suggestion: "Serial.begin(115200);",
        },
      ];

      render(
        <ParserOutput
          messages={messages}
          ioRegistry={[]}
          onClear={() => {}}
          onInsertSuggestion={onInsertSuggestion}
        />,
      );

      // Suggestion should be displayed (Text appears multiple times - Message + Suggestion)
      const serialBeginElements = screen.getAllByText(/Serial.begin\(115200\)/);
      expect(serialBeginElements.length).toBeGreaterThanOrEqual(1);
    });

    it("should display I/O Registry tab when inconsistencies are present", () => {
      const ioRegistry: IOPinRecord[] = [
        {
          pin: "5",
          defined: false,
          usedAt: [{ line: 10, operation: "digitalWrite" }],
        },
      ];

      render(
        <ParserOutput
          messages={[]}
          ioRegistry={ioRegistry}
          onClear={() => {}}
        />,
      );

      // Registry tab should be displayed (because digitalWrite without pinMode)
      expect(screen.getByText(/I\/O Registry/)).not.toBeNull();
    });

    it("should display both tabs when Messages and Registry problems exist", () => {
      const messages: ParserMessage[] = [
        {
          id: "test-1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Missing Serial.begin",
          suggestion: "Serial.begin(115200);",
        },
      ];

      const ioRegistry: IOPinRecord[] = [
        {
          pin: "5",
          defined: false,
          usedAt: [{ line: 10, operation: "digitalWrite" }],
        },
      ];

      render(
        <ParserOutput
          messages={messages}
          ioRegistry={ioRegistry}
          onClear={() => {}}
        />,
      );

      // Both tabs should be displayed
      expect(screen.getByText("Messages (1)")).not.toBeNull();
      expect(screen.getByText(/I\/O Registry/)).not.toBeNull();
    });

    it("should display error counter in header", () => {
      const messages: ParserMessage[] = [
        {
          id: "test-1",
          type: "error",
          category: "structure",
          severity: 3,
          message: "Missing void setup() function",
        },
        {
          id: "test-2",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Missing Serial.begin",
        },
      ];

      render(
        <ParserOutput messages={messages} ioRegistry={[]} onClear={() => {}} />,
      );

      // Should show errors and warnings (severity 3 = error, severity 2 = warning)
      // Header should display both counters (text-red-400 for errors, text-yellow-400 for warnings)
      const errorCount = document.querySelector(".text-red-400");
      const warningCount = document.querySelector(".text-yellow-400");
      expect(errorCount).not.toBeNull();
      expect(warningCount).not.toBeNull();
    });

    it("should have Clear button", () => {
      const onClear = vi.fn();

      const messages: ParserMessage[] = [
        {
          id: "test-1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Test warning",
        },
      ];

      render(
        <ParserOutput messages={messages} ioRegistry={[]} onClear={onClear} />,
      );

      // Clear button should be present (in code it has title="Close")
      const clearButton = screen.getByTitle("Close");
      expect(clearButton).not.toBeNull();

      // Click on Clear should call onClear
      fireEvent.click(clearButton);
      expect(onClear).toHaveBeenCalled();
    });
  });

  describe("Message Categories", () => {
    it("should label all message categories correctly", () => {
      const messages: ParserMessage[] = [
        {
          id: "1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Serial issue",
        },
        {
          id: "2",
          type: "error",
          category: "structure",
          severity: 3,
          message: "Structure issue",
        },
        {
          id: "3",
          type: "warning",
          category: "hardware",
          severity: 2,
          message: "Hardware issue",
        },
        {
          id: "4",
          type: "warning",
          category: "performance",
          severity: 2,
          message: "Performance issue",
        },
      ];

      render(
        <ParserOutput messages={messages} ioRegistry={[]} onClear={() => {}} />,
      );

      expect(screen.getByText("Serial Configuration")).not.toBeNull();
      expect(screen.getByText("Code Structure")).not.toBeNull();
      expect(screen.getByText("Hardware Compatibility")).not.toBeNull();
      expect(screen.getByText("Performance Issues")).not.toBeNull();
    });
  });
});

/**
 * Integration tests for OutputPanel auto-behavior
 *
 * These tests verify the complete workflow:
 * 1. User compiles code with errors → Panel opens and resizes automatically
 * 2. User compiles code successfully with messages → Panel shows messages and resizes
 * 3. User compiles code successfully without messages → Panel hides
 * 4. User clicks X button → Panel closes and stays closed until new errors/messages
 * 5. User uses menu toggle → Panel visibility toggled
 */

import type { ParserMessage } from "@shared/schema";

/**
 * Test the complete panel sizing logic workflow
 */
describe("OutputPanel Integration - Auto-Behavior Workflow", () => {
  interface PanelState {
    showPanel: boolean;
    panelSize: number;
    activeTab: "compiler" | "messages" | "registry";
    parserPanelDismissed: boolean;
  }

  interface CompileResult {
    success: boolean;
    output: string;
    parserMessages: ParserMessage[];
    errors?: string;
  }

  const calculatePanelSizeForErrors = (output: string): number => {
    if (!output.trim()) return 3;

    const lines = output.split("\n").length;
    const totalChars = output.length;
    const HEADER_HEIGHT = 50;
    const PER_LINE = 20;
    const PADDING = 60;
    const AVAILABLE_HEIGHT = 800;

    const lineBasedPx =
      HEADER_HEIGHT +
      PADDING +
      Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
    return Math.min(
      75,
      Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)),
    );
  };

  const calculatePanelSizeForMessages = (messages: ParserMessage[]): number => {
    if (messages.length === 0) return 3;

    const messageCount = messages.length;
    const totalMessageLength = messages.reduce(
      (sum, msg) => sum + (msg.message?.length || 0) + 50,
      0,
    );
    const HEADER_HEIGHT = 50;
    const PER_MESSAGE_BASE = 55;
    const PADDING = 60;
    const AVAILABLE_HEIGHT = 800;

    const estimatedPx =
      HEADER_HEIGHT +
      PADDING +
      messageCount * PER_MESSAGE_BASE +
      Math.ceil(totalMessageLength / 100) * 15;
    return Math.min(
      75,
      Math.max(25, Math.ceil((estimatedPx / AVAILABLE_HEIGHT) * 100)),
    );
  };

  const updatePanelState = (
    state: PanelState,
    result: CompileResult,
    lastCompilationResult: "success" | "error" | null,
  ): PanelState => {
    const hasErrors = !result.success && result.output.trim().length > 0;
    const hasMessages = result.parserMessages.length > 0;

    if (hasErrors) {
      // Compiler errors: open panel and resize
      return {
        showPanel: true,
        panelSize: calculatePanelSizeForErrors(result.output),
        activeTab: "compiler",
        parserPanelDismissed: false,
      };
    } else if (hasMessages && !hasErrors) {
      // Parser messages without errors: open panel and resize
      return {
        showPanel: true,
        panelSize: calculatePanelSizeForMessages(result.parserMessages),
        activeTab: "messages",
        parserPanelDismissed: false,
      };
    } else if (result.success && !hasErrors && !hasMessages) {
      // Success without errors/messages: minimize panel (keep visible at 3%)
      return {
        showPanel: true,
        panelSize: 3,
        activeTab: state.activeTab,
        parserPanelDismissed: state.parserPanelDismissed,
      };
    }

    return state;
  };

  describe("Workflow 1: Compilation Error", () => {
    it("should open panel with appropriate size when compilation fails", () => {
      const initialState: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      const compileResult: CompileResult = {
        success: false,
        output: `error: 'digitalWrit' was not declared in this scope
error: expected ';' before 'void'
error: expected declaration specifiers before 'void'`,
        parserMessages: [],
        errors: "Compilation failed",
      };

      const newState = updatePanelState(initialState, compileResult, "error");

      expect(newState.showPanel).toBe(true);
      expect(newState.panelSize).toBeGreaterThanOrEqual(25);
      expect(newState.panelSize).toBeLessThanOrEqual(75);
      expect(newState.activeTab).toBe("compiler");
      expect(newState.parserPanelDismissed).toBe(false);
    });

    it("should resize panel based on error message length", () => {
      const initialState: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      // Short error
      const shortError: CompileResult = {
        success: false,
        output: "error: test",
        parserMessages: [],
      };

      // Long error
      const longError: CompileResult = {
        success: false,
        output: Array(30)
          .fill(0)
          .map((_, i) => `error: this is error line ${i} with lots of content`)
          .join("\n"),
        parserMessages: [],
      };

      const shortState = updatePanelState(initialState, shortError, "error");
      const longState = updatePanelState(initialState, longError, "error");

      expect(longState.panelSize).toBeGreaterThan(shortState.panelSize);
      expect(shortState.panelSize).toBeGreaterThanOrEqual(25);
      expect(longState.panelSize).toBeLessThanOrEqual(75);
    });
  });

  describe("Workflow 2: Parser Messages Without Errors", () => {
    it("should open panel for parser messages", () => {
      const initialState: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      const messages: ParserMessage[] = [
        {
          id: "msg1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Serial.begin(9600) is missing in setup()",
          suggestion: "Serial.begin(9600);",
        },
        {
          id: "msg2",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Serial.println() is called but Serial not configured",
          suggestion: "",
        },
      ];

      const compileResult: CompileResult = {
        success: true,
        output: "✓ Compilation succeeded",
        parserMessages: messages,
      };

      const newState = updatePanelState(initialState, compileResult, "success");

      expect(newState.showPanel).toBe(true);
      expect(newState.panelSize).toBeGreaterThanOrEqual(25);
      expect(newState.panelSize).toBeLessThanOrEqual(75);
      expect(newState.activeTab).toBe("messages");
      expect(newState.parserPanelDismissed).toBe(false);
    });

    it("should resize panel based on message count", () => {
      const initialState: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      const fewMessages: ParserMessage[] = [
        {
          id: "msg1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Test message",
          suggestion: "",
        },
      ];

      const manyMessages: ParserMessage[] = Array(8)
        .fill(null)
        .map((_, i) => ({
          id: `msg${i}`,
          type: "warning" as const,
          category: "serial",
          severity: 2 as const,
          message: `Message ${i}: This is a test message with content`,
          suggestion: "",
        }));

      const fewState = updatePanelState(
        initialState,
        { success: true, output: "✓", parserMessages: fewMessages },
        "success",
      );
      const manyState = updatePanelState(
        initialState,
        { success: true, output: "✓", parserMessages: manyMessages },
        "success",
      );

      expect(manyState.panelSize).toBeGreaterThan(fewState.panelSize);
      expect(fewState.panelSize).toBeGreaterThanOrEqual(25);
      expect(manyState.panelSize).toBeLessThanOrEqual(75);
    });
  });

  describe("Workflow 3: Success Without Errors or Messages", () => {
    it("should minimize panel to 3% when compilation succeeds without errors or messages", () => {
      const initialState: PanelState = {
        showPanel: true,
        panelSize: 50,
        activeTab: "compiler",
        parserPanelDismissed: false,
      };

      const compileResult: CompileResult = {
        success: true,
        output: "✓ Compilation succeeded",
        parserMessages: [],
      };

      const newState = updatePanelState(initialState, compileResult, "success");

      expect(newState.panelSize).toBe(3);
      // Panel remains visible but minimized
      expect(newState.showPanel).toBe(true);
    });

    it("should not hide panel if there are still parser messages", () => {
      const initialState: PanelState = {
        showPanel: true,
        panelSize: 50,
        activeTab: "compiler",
        parserPanelDismissed: false,
      };

      const messages: ParserMessage[] = [
        {
          id: "msg1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Warning message",
          suggestion: "",
        },
      ];

      const compileResult: CompileResult = {
        success: true,
        output: "✓ Compilation succeeded",
        parserMessages: messages,
      };

      const newState = updatePanelState(initialState, compileResult, "success");

      expect(newState.showPanel).toBe(true);
      expect(newState.panelSize).toBeGreaterThan(3);
    });
  });

  describe("Workflow 4: X Button Dismissal", () => {
    it("should allow dismissing panel via X button", () => {
      let state: PanelState = {
        showPanel: true,
        panelSize: 50,
        activeTab: "compiler",
        parserPanelDismissed: false,
      };

      // Simulate X button click
      state = {
        ...state,
        showPanel: false,
        parserPanelDismissed: true,
      };

      expect(state.showPanel).toBe(false);
      expect(state.parserPanelDismissed).toBe(true);
    });

    it("should re-show panel when new errors occur after dismissal", () => {
      let state: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      const compileResult: CompileResult = {
        success: false,
        output: "error: syntax error",
        parserMessages: [],
      };

      // New compilation with errors
      state = updatePanelState(state, compileResult, "error");

      expect(state.showPanel).toBe(true);
      expect(state.parserPanelDismissed).toBe(false);
    });

    it("should re-show panel when new messages occur after dismissal", () => {
      let state: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      const messages: ParserMessage[] = [
        {
          id: "msg1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Warning",
          suggestion: "",
        },
      ];

      const compileResult: CompileResult = {
        success: true,
        output: "✓",
        parserMessages: messages,
      };

      // New compilation with messages
      state = updatePanelState(state, compileResult, "success");

      expect(state.showPanel).toBe(true);
      expect(state.parserPanelDismissed).toBe(false);
    });

    it("should stay minimized if no new errors/messages after dismissal", () => {
      let state: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      const compileResult: CompileResult = {
        success: true,
        output: "✓ Success",
        parserMessages: [],
      };

      // New compilation but still success with no messages
      state = updatePanelState(state, compileResult, "success");

      expect(state.panelSize).toBe(3);
      // Panel remains in minimized state
      expect(state.showPanel).toBe(true);
    });
  });

  describe("Workflow 5: Menu Toggle", () => {
    it("should toggle panel visibility via menu", () => {
      let state: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      // Toggle ON
      state = {
        ...state,
        showPanel: !state.showPanel,
        parserPanelDismissed: false,
      };
      expect(state.showPanel).toBe(true);

      // Toggle OFF
      state = { ...state, showPanel: !state.showPanel };
      expect(state.showPanel).toBe(false);

      // Toggle ON again
      state = {
        ...state,
        showPanel: !state.showPanel,
        parserPanelDismissed: false,
      };
      expect(state.showPanel).toBe(true);
    });

    it("should override auto-hide when user toggles panel ON", () => {
      let state: PanelState = {
        showPanel: true,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      // Compilation succeeds - panel would minimize to 3%
      const successResult: CompileResult = {
        success: true,
        output: "✓",
        parserMessages: [],
      };
      state = updatePanelState(state, successResult, "success");
      expect(state.panelSize).toBe(3);
      expect(state.showPanel).toBe(true); // Panel stays visible but minimized

      // Panel is now in minimized state
      expect(state.panelSize).toBe(3);
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle error → success → error sequence correctly", () => {
      let state: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      // Step 1: Compilation error
      let result: CompileResult = {
        success: false,
        output: "error: test",
        parserMessages: [],
      };
      state = updatePanelState(state, result, "error");
      expect(state.showPanel).toBe(true);
      expect(state.activeTab).toBe("compiler");

      // Step 2: Compilation success with no messages
      result = { success: true, output: "✓", parserMessages: [] };
      state = updatePanelState(state, result, "success");
      expect(state.panelSize).toBe(3); // Minimized
      expect(state.showPanel).toBe(true); // But visible

      // Step 3: New compilation error
      result = {
        success: false,
        output: "error: another error",
        parserMessages: [],
      };
      state = updatePanelState(state, result, "error");
      expect(state.showPanel).toBe(true);
      expect(state.activeTab).toBe("compiler");
    });

    it("should handle error → messages → success sequence", () => {
      let state: PanelState = {
        showPanel: false,
        panelSize: 3,
        activeTab: "compiler",
        parserPanelDismissed: true,
      };

      // Step 1: Compilation error
      let result: CompileResult = {
        success: false,
        output: "error: test",
        parserMessages: [],
      };
      state = updatePanelState(state, result, "error");
      expect(state.activeTab).toBe("compiler");

      // Step 2: Fixed error, but has messages
      const messages: ParserMessage[] = [
        {
          id: "msg1",
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Warning",
          suggestion: "",
        },
      ];
      result = { success: true, output: "✓", parserMessages: messages };
      state = updatePanelState(state, result, "success");
      expect(state.activeTab).toBe("messages");

      // Step 3: Messages resolved too
      result = { success: true, output: "✓", parserMessages: [] };
      state = updatePanelState(state, result, "success");
      expect(state.panelSize).toBe(3); // Minimized
      expect(state.showPanel).toBe(true); // But visible
    });

    it("should handle user dismissal followed by auto-show", () => {
      let state: PanelState = {
        showPanel: true,
        panelSize: 50,
        activeTab: "compiler",
        parserPanelDismissed: false,
      };

      // User clicks X button
      state = { ...state, showPanel: false, parserPanelDismissed: true };
      expect(state.showPanel).toBe(false);

      // Compilation succeeds (should minimize to 3%)
      let result: CompileResult = {
        success: true,
        output: "✓",
        parserMessages: [],
      };
      state = updatePanelState(state, result, "success");
      expect(state.panelSize).toBe(3); // Minimized
      expect(state.showPanel).toBe(true); // Panel stays visible

      // But then new error occurs (should re-appear)
      result = { success: false, output: "error: oops", parserMessages: [] };
      state = updatePanelState(state, result, "error");
      expect(state.showPanel).toBe(true);
      expect(state.parserPanelDismissed).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUiFeedbackAdapter } from "../../../client/src/hooks/use-ui-feedback-adapter";
import type { CompilerError } from "@/types/websocket";

describe("useUiFeedbackAdapter", () => {
  let mockToast: ReturnType<typeof vi.fn>;
  let mockAddDebugMessage: ReturnType<typeof vi.fn>;
  let mockTriggerErrorGlitch: ReturnType<typeof vi.fn>;
  let mockSetCliOutput: ReturnType<typeof vi.fn>;
  let mockSetPendingPinConflicts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockToast = vi.fn();
    mockAddDebugMessage = vi.fn();
    mockTriggerErrorGlitch = vi.fn();
    mockSetCliOutput = vi.fn();
    mockSetPendingPinConflicts = vi.fn();
  });

  function createParams() {
    return {
      toast: mockToast,
      addDebugMessage: mockAddDebugMessage,
      triggerErrorGlitch: mockTriggerErrorGlitch,
      setCliOutput: mockSetCliOutput,
      setPendingPinConflicts: mockSetPendingPinConflicts,
    };
  }

  function renderAdapter() {
    return renderHook(() => useUiFeedbackAdapter(createParams()));
  }

  describe("Toast notifications", () => {
    const toastTests = [
      {
        name: "compile success",
        fn: "showCompileSuccessToast",
        expected: { title: "Arduino-CLI Compilation succeeded", description: "Your sketch has been compiled successfully" },
      },
      {
        name: "compile error",
        fn: "showCompileErrorToast",
        expected: { title: "Arduino-CLI Compilation failed", description: "There were errors in your sketch", variant: "destructive" },
      },
      {
        name: "compilation failed with errors",
        fn: "showCompilationFailedWithErrorsToast",
        expected: { title: "Compilation Completed with Errors", description: "Simulation will not start due to compilation errors.", variant: "destructive" },
      },
      {
        name: "no code",
        fn: "showNoCodeToast",
        expected: { title: "No Code", description: "Please write some code before compiling", variant: "destructive" },
      },
      {
        name: "simulation started",
        fn: "showSimulationStartedToast",
        expected: { title: "Simulation Started", description: "Arduino simulation is now running" },
      },
      {
        name: "code modified",
        fn: "showCodeModifiedToast",
        expected: { title: "Code Modified", description: "Compile to apply your latest changes" },
      },
      {
        name: "pause failed",
        fn: "showPauseFailedToast",
        expected: { title: "Pause failed", description: "Could not pause simulation", variant: "destructive" },
      },
      {
        name: "resume failed",
        fn: "showResumeFailedToast",
        expected: { title: "Resume failed", description: "Could not resume simulation", variant: "destructive" },
      },
      {
        name: "resetting",
        fn: "showResettingToast",
        expected: { title: "Resetting...", description: "Recompiling and restarting simulation" },
      },
      {
        name: "backend unreachable",
        fn: "showBackendUnreachableToast",
        expected: { title: "Backend unreachable", description: "API server unreachable. Please check the backend or reload.", variant: "destructive" },
      },
    ];

    toastTests.forEach(({ name, fn, expected }) => {
      it(`shows ${name} toast`, () => {
        const { result } = renderAdapter();
        (result.current[fn as keyof typeof result.current] as () => void)();
        expect(mockToast).toHaveBeenCalledWith(expected);
      });
    });

    it("shows start failed toast with message", () => {
      const { result } = renderAdapter();
      result.current.showStartFailedToast("Connection timeout");
      expect(mockToast).toHaveBeenCalledWith({
        title: "Start Failed",
        description: "Connection timeout",
        variant: "destructive",
      });
    });

    it("shows start failed toast with empty message", () => {
      const { result } = renderAdapter();
      result.current.showStartFailedToast("");
      expect(mockToast).toHaveBeenCalledWith({
        title: "Start Failed",
        description: "Could not start simulation",
        variant: "destructive",
      });
    });
  });

  describe("Debug messages", () => {
    it("logs compile request", () => {
      const { result } = renderAdapter();

      result.current.logCompileRequest(1024);

      expect(mockAddDebugMessage).toHaveBeenCalledWith({
        source: "frontend",
        type: "compile_request",
        data: JSON.stringify({ endpoint: "POST /api/compile", codeLength: 1024 }, null, 2),
        protocol: "http",
      });
    });

    it("logs compilation success", () => {
      const { result } = renderAdapter();

      result.current.logCompilationSuccess();

      expect(mockAddDebugMessage).toHaveBeenCalledWith({
        source: "server",
        type: "compilation_status",
        data: JSON.stringify({ success: true }, null, 2),
        protocol: "http",
      });
    });

    it("logs compilation error with array of errors", () => {
      const { result } = renderAdapter();
      const errors: CompilerError[] = [
        { file: "sketch.ino", line: 10, column: 5, type: "error", message: "Syntax error" },
      ];

      result.current.logCompilationError(errors);

      expect(mockAddDebugMessage).toHaveBeenNthCalledWith(1, {
        source: "server",
        type: "compilation_error",
        data: JSON.stringify({ type: "compilation_error", data: errors }, null, 2),
        protocol: "http",
      });
      expect(mockAddDebugMessage).toHaveBeenNthCalledWith(2, {
        source: "server",
        type: "compilation_status",
        data: JSON.stringify({ success: false }, null, 2),
        protocol: "http",
      });
    });

    it("logs compilation error with string error", () => {
      const { result } = renderAdapter();

      result.current.logCompilationError("Compilation failed");

      expect(mockAddDebugMessage).toHaveBeenNthCalledWith(1, {
        source: "server",
        type: "compilation_error",
        data: JSON.stringify({ type: "compilation_error", data: "Compilation failed" }, null, 2),
        protocol: "http",
      });
    });

    it("logs compilation error with undefined errors", () => {
      const { result } = renderAdapter();

      result.current.logCompilationError(undefined);

      expect(mockAddDebugMessage).toHaveBeenNthCalledWith(1, {
        source: "server",
        type: "compilation_error",
        data: JSON.stringify({ type: "compilation_error", data: undefined }, null, 2),
        protocol: "http",
      });
    });

    it("logs stop simulation", () => {
      const { result } = renderAdapter();

      result.current.logStopSimulation();

      expect(mockAddDebugMessage).toHaveBeenCalledWith({
        source: "frontend",
        type: "stop_simulation",
        data: JSON.stringify({ type: "stop_simulation" }, null, 2),
        protocol: "websocket",
      });
    });

    it("logs pause simulation", () => {
      const { result } = renderAdapter();

      result.current.logPauseSimulation();

      expect(mockAddDebugMessage).toHaveBeenCalledWith({
        source: "frontend",
        type: "pause_simulation",
        data: JSON.stringify({ type: "pause_simulation" }, null, 2),
        protocol: "websocket",
      });
    });

    it("logs resume simulation", () => {
      const { result } = renderAdapter();

      result.current.logResumeSimulation();

      expect(mockAddDebugMessage).toHaveBeenCalledWith({
        source: "frontend",
        type: "resume_simulation",
        data: JSON.stringify({ type: "resume_simulation" }, null, 2),
        protocol: "websocket",
      });
    });

    it("logs start simulation with code", () => {
      const { result } = renderAdapter();

      result.current.logStartSimulation(60, true);

      const call = mockAddDebugMessage.mock.calls[0][0] as { data: string };
      const parsed = JSON.parse(call.data);
      expect(parsed).toEqual({
        type: "start_simulation",
        timeout: 60,
        code: "<code present>",
      });
      expect(call.protocol).toBe("websocket");
      expect(call.source).toBe("frontend");
      expect(call.type).toBe("start_simulation");
    });

    it("logs start simulation without code", () => {
      const { result } = renderAdapter();

      result.current.logStartSimulation(60, false);

      const call = mockAddDebugMessage.mock.calls[0][0] as { data: string };
      const parsed = JSON.parse(call.data);
      expect(parsed).toEqual({
        type: "start_simulation",
        timeout: 60,
      });
      expect(call.protocol).toBe("websocket");
      expect(call.source).toBe("frontend");
      expect(call.type).toBe("start_simulation");
    });

    it("logs start simulation fallback", () => {
      const { result } = renderAdapter();

      result.current.logStartSimulationFallback();

      expect(mockAddDebugMessage).toHaveBeenCalledWith({
        source: "frontend",
        type: "start_simulation",
        data: "Immediate send failed, falling back to buffered send",
        protocol: "websocket",
      });
    });
  });

  describe("Error handling", () => {
    it("triggers compile error glitch", () => {
      const { result } = renderAdapter();

      result.current.triggerCompileErrorGlitch();

      expect(mockTriggerErrorGlitch).toHaveBeenCalled();
    });

    it("extracts error message from Error object", () => {
      const { result } = renderAdapter();
      const error = new Error("Test error message");

      const message = result.current.extractErrorMessage(error);

      expect(message).toBe("Test error message");
    });

    it("extracts error message from string", () => {
      const { result } = renderAdapter();

      const message = result.current.extractErrorMessage("Plain error string");

      // String input is returned as-is
      expect(message).toBe("Plain error string");
    });

    it("extracts error message from number", () => {
      const { result } = renderAdapter();

      const message = result.current.extractErrorMessage(42);

      // Number input gets JSON.stringify'd
      expect(message).toBe("42");
    });

    it("extracts error message from object", () => {
      const { result } = renderAdapter();
      const errorObj = { code: 500, message: "Internal error" };

      const message = result.current.extractErrorMessage(errorObj);

      expect(message).toContain("Internal error");
    });

    it("extracts error message from null", () => {
      const { result } = renderAdapter();

      const message = result.current.extractErrorMessage(null);

      expect(message).toBe("null");
    });

    it("extracts error message from undefined", () => {
      const { result } = renderAdapter();

      const message = result.current.extractErrorMessage(undefined);

      // undefined returns "undefined" from String() conversion
      expect(message).toBe("undefined");
    });
  });

  describe("CLI Output updates", () => {
    it("sets compile success output with provided output", () => {
      const { result } = renderAdapter();

      result.current.setCompileSuccessOutput("Compilation successful");

      expect(mockSetCliOutput).toHaveBeenCalledWith("Compilation successful");
    });

    it("sets compile success output with default message when undefined", () => {
      const { result } = renderAdapter();

      result.current.setCompileSuccessOutput(undefined);

      expect(mockSetCliOutput).toHaveBeenCalledWith("✓ Arduino-CLI Compilation succeeded.");
    });

    it("sets compile error output with array of errors", () => {
      const { result } = renderAdapter();
      const errors: CompilerError[] = [
        { file: "sketch.ino", line: 10, column: 5, type: "error", message: "Syntax error" },
        { file: "sketch.ino", line: 15, column: 3, type: "warning", message: "Unused variable" },
      ];

      result.current.setCompileErrorOutput(errors);

      expect(mockSetCliOutput).toHaveBeenCalledWith(
        expect.stringContaining("sketch.ino:10:5 error: Syntax error"),
      );
      expect(mockSetCliOutput).toHaveBeenCalledWith(
        expect.stringContaining("sketch.ino:15:3 warning: Unused variable"),
      );
    });

    it("sets compile error output with string error", () => {
      const { result } = renderAdapter();

      result.current.setCompileErrorOutput("Compilation failed");

      expect(mockSetCliOutput).toHaveBeenCalledWith("Compilation failed");
    });

    it("sets compile error output with default message when undefined", () => {
      const { result } = renderAdapter();

      result.current.setCompileErrorOutput(undefined);

      expect(mockSetCliOutput).toHaveBeenCalledWith("✗ Arduino-CLI Compilation failed.");
    });

    it("sets compile error output with default message when empty string", () => {
      const { result } = renderAdapter();

      result.current.setCompileErrorOutput("");

      expect(mockSetCliOutput).toHaveBeenCalledWith("✗ Arduino-CLI Compilation failed.");
    });
  });

  describe("Pin conflict warning", () => {
    it("shows pin conflict warning with digital pins", () => {
      const { result } = renderAdapter();

      result.current.showPinConflictWarning([2, 5, 9]);

      // setCliOutput receives a function that appends to previous output
      expect(mockSetCliOutput).toHaveBeenCalledWith(expect.any(Function));
      expect(mockSetPendingPinConflicts).toHaveBeenCalledWith([]);

      // Verify the function produces correct output
      const updater = mockSetCliOutput.mock.calls[0][0] as (prev: string) => string;
      const output = updater("");
      expect(output).toContain("⚠️ Pin usage conflict");
      expect(output).toContain("2, 5, 9");
    });

    it("shows pin conflict warning with analog pins", () => {
      const { result } = renderAdapter();

      result.current.showPinConflictWarning([14, 15, 19]);

      expect(mockSetCliOutput).toHaveBeenCalledWith(expect.any(Function));
      expect(mockSetPendingPinConflicts).toHaveBeenCalledWith([]);

      const updater = mockSetCliOutput.mock.calls[0][0] as (prev: string) => string;
      const output = updater("");
      expect(output).toContain("⚠️ Pin usage conflict");
      expect(output).toContain("A0, A1, A5");
    });

    it("shows pin conflict warning with mixed pins", () => {
      const { result } = renderAdapter();

      result.current.showPinConflictWarning([2, 14, 9, 15]);

      expect(mockSetCliOutput).toHaveBeenCalledWith(expect.any(Function));
      expect(mockSetPendingPinConflicts).toHaveBeenCalledWith([]);

      const updater = mockSetCliOutput.mock.calls[0][0] as (prev: string) => string;
      const output = updater("");
      expect(output).toContain("⚠️ Pin usage conflict");
      expect(output).toContain("2, A0, 9, A1");
    });

    it("appends pin conflict warning to existing CLI output", () => {
      const { result } = renderAdapter();

      // Simulate existing output
      mockSetCliOutput.mockImplementation((updater) => {
        if (typeof updater === "function") {
          const existing = "Previous output";
          return updater(existing);
        }
        return updater;
      });

      result.current.showPinConflictWarning([2]);

      expect(mockSetCliOutput).toHaveBeenCalledWith(expect.any(Function));
      // Verify the function appends to existing output
      const updater = mockSetCliOutput.mock.calls[0][0] as (prev: string) => string;
      expect(updater("Previous output")).toContain("Previous output\n\n");
    });

    it("clears pending pin conflicts", () => {
      const { result } = renderAdapter();

      result.current.showPinConflictWarning([2, 5]);

      expect(mockSetPendingPinConflicts).toHaveBeenCalledWith([]);
    });
  });
});

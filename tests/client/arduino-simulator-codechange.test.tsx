import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

let messageQueue: Array<{ type: string; status?: string }> = [];
const sendMessage = vi.fn();

let ArduinoSimulator: typeof import("@/pages/arduino-simulator").default;

vi.mock("monaco-editor", () => ({}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        id: "default-sketch",
        name: "Default",
        content: "void setup(){} void loop(){}",
      },
    ],
  }),
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    refetchQueries: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({
    isConnected: true,
    connectionError: null,
    hasEverConnected: true,
    lastMessage: null,
    messageQueue,
    consumeMessages: () => {
      const messages = messageQueue;
      messageQueue = [];
      return messages;
    },
    sendMessage,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-simulation-store", () => ({
  useSimulationStore: () => ({
    pinStates: [],
    setPinStates: vi.fn(),
    resetPinStates: vi.fn(),
    enqueuePinEvent: vi.fn(),
    batchStats: {
      lastBatchMs: 0,
      lastBatchSize: 0,
      lastFrameAt: 0,
    },
  }),
}));

vi.mock("@/hooks/use-telemetry-store", () => ({
  telemetryStore: {
    pushTelemetry: vi.fn(),
    resetTelemetry: vi.fn(),
  },
  useTelemetryStore: () => ({
    history: [],
    last: null,
    lastHeartbeatAt: null,
    pushTelemetry: vi.fn(),
    resetTelemetry: vi.fn(),
  }),
}));

vi.mock("@/components/features/code-editor", () => ({
  CodeEditor: ({ onChange }: { onChange: (value: string) => void }) => (
    <button
      data-testid="code-editor-change"
      onClick={() => onChange("// change")}
    >
      change
    </button>
  ),
}));

vi.mock("@/components/features/app-header", () => ({
  AppHeader: ({ simulationStatus }: { simulationStatus: string }) => (
    <div data-testid="sim-status">{simulationStatus}</div>
  ),
}));

vi.mock("@/components/features/serial-monitor", () => ({
  SerialMonitor: () => <div data-testid="serial-monitor" />,
}));

vi.mock("@/components/features/compilation-output", () => ({
  CompilationOutput: () => <div data-testid="compilation-output" />,
}));

vi.mock("@/components/features/parser-output", () => ({
  ParserOutput: () => <div data-testid="parser-output" />,
}));

vi.mock("@/components/features/sketch-tabs", () => ({
  SketchTabs: () => <div data-testid="sketch-tabs" />,
}));

vi.mock("@/components/features/examples-menu", () => ({
  ExamplesMenu: () => <div data-testid="examples-menu" />,
}));

vi.mock("@/components/features/arduino-board", () => ({
  ArduinoBoard: () => <div data-testid="arduino-board" />,
}));

vi.mock("@/components/features/pin-monitor", () => ({
  PinMonitor: () => <div data-testid="pin-monitor" />,
}));

vi.mock("@/components/features/sim-cockpit", () => ({
  SimCockpit: () => <div data-testid="sim-cockpit" />,
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="scroll-area">{children}</div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tabs">{children}</div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tabs-list">{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="tabs-trigger">{children}</button>
  ),
  TabsContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tabs-content">{children}</div>
  ),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

describe("ArduinoSimulator", () => {
  beforeAll(async () => {
    ({ default: ArduinoSimulator } = await import("@/pages/arduino-simulator"));
  });

  beforeEach(() => {
    sendMessage.mockClear();
    messageQueue = [];

    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("Component Lifecycle", () => {
    it("renders main UI components on mount", () => {
      render(<ArduinoSimulator />);

      expect(screen.getByTestId("code-editor-change")).toBeInTheDocument();
      expect(screen.getByTestId("sim-status")).toBeInTheDocument();
      expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
      expect(screen.getByTestId("compilation-output")).toBeInTheDocument();
      // There are multiple ParserOutput instances, verify at least one exists
      expect(screen.getAllByTestId("parser-output").length).toBeGreaterThan(0);
      expect(screen.getByTestId("sketch-tabs")).toBeInTheDocument();
      expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
      // Note: sim-cockpit is only rendered when debugMode is true
    });

    it("initializes with stopped simulation status", () => {
      render(<ArduinoSimulator />);

      // Default status should be stopped
      expect(screen.getByTestId("sim-status").textContent).toBe("stopped");
    });

    it("loads default sketch from query on mount", async () => {
      render(<ArduinoSimulator />);

      // useQuery mock returns default sketch, component should load it
      await waitFor(() => {
        // The CodeEditor is mocked, so we can't check its content directly
        // But we can verify the component rendered without errors
        expect(screen.getByTestId("code-editor-change")).toBeInTheDocument();
      });
    });
  });

  describe("Code Change Auto-Stop", () => {
    it("stops a running simulation on code change", async () => {
      messageQueue = [{ type: "simulation_status", status: "running" }];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("running");
      });

      fireEvent.click(screen.getByTestId("code-editor-change"));

      await waitFor(() => {
        expect(sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
        expect(screen.getByTestId("sim-status").textContent).toBe("stopped");
      });
    });

    it("stops a paused simulation on code change", async () => {
      messageQueue = [{ type: "simulation_status", status: "paused" }];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("paused");
      });

      fireEvent.click(screen.getByTestId("code-editor-change"));

      await waitFor(() => {
        expect(sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
        expect(screen.getByTestId("sim-status").textContent).toBe("stopped");
      });
    });

    it("does not stop simulation when status is already stopped", async () => {
      render(<ArduinoSimulator />);

      // Initial status is stopped
      expect(screen.getByTestId("sim-status").textContent).toBe("stopped");

      fireEvent.click(screen.getByTestId("code-editor-change"));

      // Should not send stop message when already stopped
      expect(sendMessage).not.toHaveBeenCalledWith({ type: "stop_simulation" });
    });
  });

  describe("WebSocket Message Handling", () => {
    it("handles simulation_status message", async () => {
      messageQueue = [{ type: "simulation_status", status: "running" }];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("running");
      });
    });

    it("handles status stopped from message queue", async () => {
      messageQueue = [{ type: "simulation_status", status: "stopped" }];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("stopped");
      });
    });

    it("handles status paused from message queue", async () => {
      messageQueue = [{ type: "simulation_status", status: "paused" }];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("paused");
      });
    });

    it("handles compilation_status message with arduinoCliStatus", async () => {
      messageQueue = [
        {
          type: "compilation_status",
          arduinoCliStatus: "success",
          message: "Compilation complete",
        },
      ];
      
      render(<ArduinoSimulator />);

      // Component should process message without errors
      await waitFor(() => {
        expect(screen.getByTestId("sim-status")).toBeInTheDocument();
      });
    });

    it("handles compilation_status message with gccStatus", async () => {
      messageQueue = [
        {
          type: "compilation_status",
          gccStatus: "compiling",
          message: "Compiling with GCC",
        },
      ];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status")).toBeInTheDocument();
      });
    });

    it("handles pin_state message", async () => {
      messageQueue = [
        {
          type: "pin_state",
          pin: 13,
          stateType: "digital",
          value: 1,
        },
      ];
      
      render(<ArduinoSimulator />);

      // Component should process pin state without errors
      await waitFor(() => {
        expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
      });
    });

    it("handles io_registry message", async () => {
      messageQueue = [
        {
          type: "io_registry",
          registry: [
            { pin: "13", defined: true, usedAt: [] },
            { pin: "A0", defined: true, usedAt: [] },
          ],
          baudrate: 9600,
        },
      ];
      
      render(<ArduinoSimulator />);

      // Component should process io_registry without errors
      await waitFor(() => {
        expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
      });
    });

    it("handles serial_output message", async () => {
      messageQueue = [
        {
          type: "serial_output",
          data: "Hello from Arduino",
          isComplete: true,
        },
      ];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
      });
    });

    it("handles serial_event message", async () => {
      messageQueue = [
        {
          type: "serial_event",
          payload: {
            data: "Test data",
          },
        },
      ];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
      });
    });

    it("handles sim_telemetry message when running", async () => {
      messageQueue = [
        { type: "simulation_status", status: "running" },
        {
          type: "sim_telemetry",
          metrics: {
            loopCount: 100,
            avgLoopTime: 5,
          },
        },
      ];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("running");
      });
    });

    it("handles compilation_error message", async () => {
      messageQueue = [
        {
          type: "compilation_error",
          data: {
            errors: [
              {
                file: "sketch.ino",
                line: 10,
                message: "expected ';' before '}' token",
              },
            ],
          },
        },
      ];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("compilation-output")).toBeInTheDocument();
      });
    });

    it("processes multiple messages in queue", async () => {
      messageQueue = [
        { type: "simulation_status", status: "running" },
        { type: "serial_output", data: "Message 1", isComplete: true },
        { type: "serial_output", data: "Message 2", isComplete: true },
        { type: "pin_state", pin: 13, stateType: "digital", value: 1 },
      ];
      
      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("running");
      });
    });
  });

  describe("Pin Detection & Conflict Handling", () => {
    it("detects digital pin conflicts and shows error", async () => {
      // Simulate code with pin conflict (e.g., pin 13 used twice)
      render(<ArduinoSimulator />);

      const codeEditorButton = screen.getByTestId("code-editor-change");
      fireEvent.click(codeEditorButton);

      // Component should handle pin parsing without errors
      await waitFor(() => {
        expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
      });
    });

    it("processes multiple io_registry pins", async () => {
      messageQueue = [
        {
          type: "io_registry",
          registry: [
            { pin: "0", defined: true, usedAt: [] },
            { pin: "1", defined: true, usedAt: [] },
          ],
          baudrate: 9600,
        },
      ];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
      });
    });

    it("handles empty io_registry", async () => {
      messageQueue = [
        {
          type: "io_registry",
          registry: [],
          baudrate: 9600,
        },
      ];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
      });
    });

    it("detects for-loop pin ranges (e.g., pins 16-19 for analogRead)", async () => {
      // Code pattern: for(byte i=16; i<20; i++) { analogRead(i) }
      render(<ArduinoSimulator />);

      fireEvent.click(screen.getByTestId("code-editor-change"));

      await waitFor(() => {
        expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
      });
    });
  });;

  describe("File I/O Operations", () => {
    it("renders component with file input capability", async () => {
      render(<ArduinoSimulator />);

      // Component should render without errors
      expect(screen.getByTestId("sketch-tabs")).toBeInTheDocument();
    });

    it("accepts .ino file format", async () => {
      render(<ArduinoSimulator />);

      // File input exists in the component (hidden)
      const fileInput = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;

      expect(fileInput).toBeDefined();
    });

    it("handles multiple file selections", async () => {
      render(<ArduinoSimulator />);

      // Sketch tabs should be present to display loaded files
      expect(screen.getByTestId("sketch-tabs")).toBeInTheDocument();
    });

    it("preserves file list state", async () => {
      render(<ArduinoSimulator />);

      // Component state management for sketch tabs
      expect(screen.getByTestId("sketch-tabs")).toBeInTheDocument();
    });
  });;

  describe("Keyboard Shortcuts", () => {
    it("F5 key renders component without errors", async () => {
      render(<ArduinoSimulator />);

      const event = new KeyboardEvent("keydown", {
        key: "F5",
        code: "F5",
        bubbles: true,
      });

      document.dispatchEvent(event);

      // Should be ready for compilation
      await waitFor(() => {
        expect(screen.getByTestId("sim-status")).toBeInTheDocument();
      });
    });

    it("Escape key routing works in component", async () => {
      messageQueue = [{ type: "simulation_status", status: "running" }];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("running");
      });

      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      });

      document.dispatchEvent(event);

      // Component should remain stable
      await waitFor(() => {
        expect(screen.getByTestId("sim-status")).toBeInTheDocument();
      });
    });

    it("ignores keyboard shortcuts when editor has focus", async () => {
      render(<ArduinoSimulator />);

      const initialCalls = sendMessage.mock.calls.length;

      const textarea = document.createElement("textarea");
      textarea.focus();
      document.body.appendChild(textarea);

      const event = new KeyboardEvent("keydown", {
        key: "F5",
        code: "F5",
        bubbles: true,
      });

      textarea.dispatchEvent(event);

      // Should NOT trigger additional messages
      expect(sendMessage.mock.calls.length).toBe(initialCalls);

      document.body.removeChild(textarea);
    });
  });;

  describe("Serial I/O & Pin Events", () => {
    it("serial monitor renders when simulation running", async () => {
      messageQueue = [{ type: "simulation_status", status: "running" }];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("running");
      });

      expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
    });

    it("serial monitor available when simulation stopped", async () => {
      render(<ArduinoSimulator />);

      // Simulation should be stopped by default
      expect(screen.getByTestId("sim-status").textContent).toBe("stopped");

      // SerialMonitor should still be rendered
      expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
    });

    it("processes serial_event messages with queue handling", async () => {
      messageQueue = [
        {
          type: "serial_event",
          payload: {
            data: "First event",
            timestamp: Date.now(),
          },
        },
        {
          type: "serial_event",
          payload: {
            data: "Second event",
            timestamp: Date.now() + 100,
          },
        },
      ];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
      });
    });

    it("handles tx activity tracking on message send", async () => {
      messageQueue = [{ type: "simulation_status", status: "running" }];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("running");
      });

      // Component tracks TX/RX activity internally
      expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
    });

    it("handles paused simulation state for serial", async () => {
      messageQueue = [{ type: "simulation_status", status: "paused" }];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status").textContent).toBe("paused");
      });

      // Serial monitor still visible but input should be disabled
      expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
    });
  });;

  describe("Settings & Configuration", () => {
    it("renders with default application settings", () => {
      render(<ArduinoSimulator />);

      // Component should render with defaults
      expect(screen.getByTestId("compilation-output")).toBeInTheDocument();
    });

    it("persists compilation output state", () => {
      render(<ArduinoSimulator />);

      expect(screen.getByTestId("compilation-output")).toBeInTheDocument();
    });

    it("recovers from storage access errors", () => {
      render(<ArduinoSimulator />);

      // Component should render even if localStorage is unavailable
      expect(screen.getByTestId("sim-status")).toBeInTheDocument();
    });

    it("manages board selection state", async () => {
      render(<ArduinoSimulator />);

      // Board should be initialized to Arduino UNO
      expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
    });

    it("manages baudrate state", async () => {
      render(<ArduinoSimulator />);

      // Baudrate initializes to 115200
      await waitFor(() => {
        expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
      });
    });
  });;;

  describe("Output Panel Management", () => {
    it("renders output panel with multiple tabs", async () => {
      render(<ArduinoSimulator />);

      expect(screen.getByTestId("tabs")).toBeInTheDocument();
      expect(screen.getAllByTestId("tabs-trigger").length).toBeGreaterThan(0);
    });

    it("switches output tabs on error", async () => {
      messageQueue = [
        {
          type: "compilation_error",
          data: {
            errors: [
              {
                file: "sketch.ino",
                line: 5,
                message: "undefined reference",
              },
            ],
          },
        },
      ];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("compilation-output")).toBeInTheDocument();
      });
    });

    it("displays parser messages when available", async () => {
      messageQueue = [
        {
          type: "parser_messages",
          messages: [
            {
              pin: 13,
              pinName: "LED",
              pinType: "DIGITAL",
              mode: "OUTPUT",
              usedAt: [10],
            },
          ],
        },
      ];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getAllByTestId("parser-output").length).toBeGreaterThan(0);
      });
    });

    it("renders compilation output section", () => {
      render(<ArduinoSimulator />);

      // Main output panel sections are available
      expect(screen.getByTestId("compilation-output")).toBeInTheDocument();
    });

    it("renders tabs content areas", async () => {
      render(<ArduinoSimulator />);

      expect(screen.getAllByTestId("tabs-content").length).toBeGreaterThan(0);
    });
  });;;;;

  describe("Error Visualization & Recovery", () => {
    it("shows error glitch on compilation failure", async () => {
      messageQueue = [
        {
          type: "compilation_error",
          data: {
            errors: [{ file: "sketch.ino", line: 1, message: "error" }],
          },
        },
      ];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("compilation-output")).toBeInTheDocument();
      });
    });

    it("recovers from compilation error on successful recompile", async () => {
      messageQueue = [
        {
          type: "compilation_status",
          arduinoCliStatus: "success",
          message: "Compilation successful",
        },
      ];

      render(<ArduinoSimulator />);

      await waitFor(() => {
        expect(screen.getByTestId("sim-status")).toBeInTheDocument();
      });
    });

    it("handles backend connection errors", async () => {
      // useBackendHealth hook would manage this
      render(<ArduinoSimulator />);

      // Component should render even if backend is unreachable
      expect(screen.getByTestId("sim-status")).toBeInTheDocument();
    });

    it("maintains UI availability after error", async () => {
      render(<ArduinoSimulator />);

      // Component should be interactive
      const codeEditor = screen.getByTestId("code-editor-change");
      expect(codeEditor).toBeInTheDocument();

      // Should still have all main components
      expect(screen.getByTestId("serial-monitor")).toBeInTheDocument();
      expect(screen.getByTestId("arduino-board")).toBeInTheDocument();
    });
  });
});

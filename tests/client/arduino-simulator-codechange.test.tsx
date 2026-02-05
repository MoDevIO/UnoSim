import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

vi.mock("@/components/features/telemetry-history-tab", () => ({
  TelemetryHistoryTab: () => <div data-testid="telemetry-history" />,
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

describe("ArduinoSimulator code change auto-stop", () => {
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
});

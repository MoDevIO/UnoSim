import { render, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let messageQueue: Array<{ type: string; status?: string }> = [];
const sendMessage = vi.fn();
let ArduinoSimulator: typeof import("@/pages/arduino-simulator").default;

// Minimal mocks required for ArduinoSimulator to mount
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await (importOriginal() as Promise<any>);
  return {
    ...actual,
    // keep simple hooks used by tests but keep actual QueryClient/Provider
    useQuery: () => ({ data: [{ id: "default-sketch", name: "Default", content: "void setup(){} void loop(){}" }] }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ refetchQueries: vi.fn() }),
  };
});

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({
    isConnected: true,
    connectionError: null,
    hasEverConnected: true,
    lastMessage: null,
    get messageQueue() { return messageQueue; },
    consumeMessages: () => { const msgs = messageQueue; messageQueue = []; return msgs; },
    sendMessage,
  }),
}));

vi.mock("@/components/features/app-header", () => ({ AppHeader: ({ simulationStatus }: { simulationStatus: string }) => (<div data-testid="sim-status">{simulationStatus}</div>) }));
vi.mock("@/components/features/code-editor", () => ({ CodeEditor: ({ onChange }: { onChange: (v: string) => void }) => (<button data-testid="code-editor-change" onClick={() => onChange("// change")}>change</button>) }));
vi.mock("@/components/features/serial-monitor", () => ({ SerialMonitor: () => <div data-testid="serial-monitor" /> }));
vi.mock("@/components/features/compilation-output", () => ({ CompilationOutput: () => <div data-testid="compilation-output" /> }));
vi.mock("@/components/features/parser-output", () => ({ ParserOutput: () => <div data-testid="parser-output" /> }));
vi.mock("@/components/features/sketch-tabs", () => ({ SketchTabs: () => <div data-testid="sketch-tabs" /> }));
vi.mock("@/components/features/arduino-board", () => ({ ArduinoBoard: () => <div data-testid="arduino-board" /> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/hooks/use-output-panel", () => ({
  useOutputPanel: () => ({
    activeTab: "compiler",
    setActiveTab: () => {},
    compilationPanelSize: 0,
    outputPanelRef: { current: { resize: () => {} } },
    outputPanelManuallyResized: false,
  }),
}));

beforeAll(async () => { ({ default: ArduinoSimulator } = await import("@/pages/arduino-simulator")); });

beforeEach(() => {
  sendMessage.mockClear();
  messageQueue = [];
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("handles simulation_status message", async () => {
  // Render component first (no pre-seeded queue)
  messageQueue = [];

  const testQueryClient = new QueryClient();
  let rerender!: ReturnType<typeof render>["rerender"];
  await act(async () => {
    ({ rerender } = render(
      <QueryClientProvider client={testQueryClient}>
        <ArduinoSimulator />
      </QueryClientProvider>
    ));
    await Promise.resolve();
  });

  // Sanity-check: hook exposes empty queue initially
  const wsMock = (await import("@/hooks/use-websocket")).useWebSocket();
  expect(wsMock.messageQueue.length).toBe(0);

  // Push message AFTER mount and cause a re-render so the hook's
  // messageQueue dependency is observed by useWebSocketHandler.
  await act(async () => {
    messageQueue = [{ type: "simulation_status", status: "running" }];

    rerender(
      <QueryClientProvider client={testQueryClient}>
        <ArduinoSimulator />
      </QueryClientProvider>
    );

    vi.runOnlyPendingTimers();
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(document.querySelector('[data-testid="sim-status"]')?.textContent).toBe("running");
  });
});

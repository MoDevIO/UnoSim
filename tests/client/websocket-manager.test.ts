/**
 * Tests for WebSocketManager singleton
 *
 * Covers: connection lifecycle, message buffering, reconnection logic,
 * event subscription, state management, test isolation helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------- WebSocket mock ----------
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  url: string;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) throw new Error("WebSocket not open");
    this.sentMessages.push(data);
  }

  close(_code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  _simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  _simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  _simulateClose(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  _simulateError() {
    this.onerror?.({ type: "error" } as Event);
  }
}

// Store created instances for assertions
let wsInstances: MockWebSocket[] = [];

vi.stubGlobal("WebSocket", class extends MockWebSocket {
  constructor(url: string) {
    super(url);
    wsInstances.push(this);
  }

  static override readonly CONNECTING = 0;
  static override readonly OPEN = 1;
  static override readonly CLOSING = 2;
  static override readonly CLOSED = 3;
});

// Stub location for URL construction
vi.stubGlobal("location", { protocol: "http:", host: "localhost:3000" });

// Mock isArduinoMessage to accept any object with a type field
vi.mock("@/types/websocket", () => ({
  isArduinoMessage: (val: unknown) =>
    typeof val === "object" && val !== null && "type" in val,
}));

// Suppress logger output
vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

// Dynamic import after mocks are set up
let getWebSocketManager: () => any;

beforeEach(async () => {
  wsInstances = [];
  vi.useFakeTimers();
  // Force fresh module on each test
  vi.resetModules();
  const mod = await import("@/lib/websocket-manager");
  getWebSocketManager = mod.getWebSocketManager;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WebSocketManager", () => {
  // ---- Singleton ----
  it("returns the same instance on repeated calls", () => {
    const a = getWebSocketManager();
    const b = getWebSocketManager();
    expect(a).toBe(b);
  });

  // ---- State defaults ----
  it("starts in disconnected state", () => {
    const mgr = getWebSocketManager();
    expect(mgr.getState()).toBe("disconnected");
    expect(mgr.isConnected()).toBe(false);
    expect(mgr.hasEverConnected()).toBe(false);
  });

  // ---- connect() ----
  it("creates a WebSocket on connect()", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    expect(wsInstances.length).toBe(1);
    expect(wsInstances[0].url).toBe("ws://localhost:3000/ws");
    expect(mgr.getState()).toBe("connecting");
  });

  it("does not create duplicate connections", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();
    mgr.connect(); // should be no-op
    expect(wsInstances.length).toBe(1);
  });

  it("handles successful connection", () => {
    const mgr = getWebSocketManager();
    const stateChanges: string[] = [];
    mgr.on("stateChange", (s: string) => stateChanges.push(s));

    mgr.connect();
    wsInstances[0]._simulateOpen();

    expect(mgr.getState()).toBe("connected");
    expect(mgr.isConnected()).toBe(true);
    expect(mgr.hasEverConnected()).toBe(true);
    expect(stateChanges).toContain("connected");
  });

  // ---- send() with buffering ----
  it("buffers messages and flushes after interval", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();

    const msg = { type: "serial_input" as const, data: "hello" };
    const result = mgr.send(msg);
    expect(result).toBe(true);

    // Not sent yet (buffered)
    expect(wsInstances[0].sentMessages.length).toBe(0);

    // Advance past buffer flush interval (30ms)
    vi.advanceTimersByTime(35);
    expect(wsInstances[0].sentMessages.length).toBe(1);
    expect(JSON.parse(wsInstances[0].sentMessages[0])).toEqual(msg);
  });

  it("force-flushes when buffer reaches max size", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();

    // MAX_BUFFER_SIZE = 100
    for (let i = 0; i < 100; i++) {
      mgr.send({ type: "serial_input" as const, data: `msg${i}` });
    }

    // Should be flushed immediately
    expect(wsInstances[0].sentMessages.length).toBe(100);
  });

  it("returns false when WebSocket is not open", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    // still CONNECTING
    const result = mgr.send({ type: "serial_input" as const, data: "x" });
    expect(result).toBe(false);
  });

  // ---- sendImmediate() ----
  it("sends immediately without buffering", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();

    const msg = { type: "serial_input" as const, data: "urgent" };
    const result = mgr.sendImmediate(msg);
    expect(result).toBe(true);
    expect(wsInstances[0].sentMessages.length).toBe(1);
  });

  it("sendImmediate returns false when not connected", () => {
    const mgr = getWebSocketManager();
    const result = mgr.sendImmediate({ type: "serial_input" as const, data: "x" });
    expect(result).toBe(false);
  });

  // ---- Message reception ----
  it("emits message events for valid incoming messages", () => {
    const mgr = getWebSocketManager();
    const received: unknown[] = [];
    mgr.on("message", (data: unknown) => received.push(data));

    mgr.connect();
    wsInstances[0]._simulateOpen();
    wsInstances[0]._simulateMessage({ type: "serial_output", data: "hello" });

    expect(received.length).toBe(1);
    expect((received[0] as any).type).toBe("serial_output");
  });

  it("ignores invalid incoming messages", () => {
    // isArduinoMessage will return false for objects without 'type'
    vi.doMock("@/types/websocket", () => ({
      isArduinoMessage: () => false,
    }));

    const mgr = getWebSocketManager();
    const received: unknown[] = [];
    mgr.on("message", (data: unknown) => received.push(data));

    mgr.connect();
    wsInstances[0]._simulateOpen();
    wsInstances[0]._simulateMessage({ invalid: true });

    // The real isArduinoMessage still guards – invalid payloads are dropped
    expect(received).toHaveLength(0);
  });

  // ---- disconnect() ----
  it("gracefully disconnects and cleans up", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();

    mgr.disconnect();
    expect(mgr.getState()).toBe("disconnected");
    expect(mgr.isConnected()).toBe(false);
  });

  // ---- Event subscriptions ----
  it("supports on/unsubscribe pattern", () => {
    const mgr = getWebSocketManager();
    const states: string[] = [];
    const unsub = mgr.on("stateChange", (s: string) => states.push(s));

    mgr.connect();
    expect(states).toContain("connecting");

    unsub();
    wsInstances[0]._simulateOpen();
    // After unsubscribe, should not receive "connected"
    expect(states).not.toContain("connected");
  });

  it("emits error events", () => {
    const mgr = getWebSocketManager();
    const errors: string[] = [];
    mgr.on("error", (e: string) => errors.push(e));

    mgr.connect();
    wsInstances[0]._simulateError();

    expect(errors.length).toBeGreaterThan(0);
  });

  // ---- Reconnection ----
  it("schedules reconnection on unexpected close", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();

    // Simulate unexpected close
    wsInstances[0]._simulateClose(1006, "abnormal");
    expect(mgr.getState()).toBe("reconnecting");

    // Advance timers to trigger reconnect
    vi.advanceTimersByTime(2000);
    expect(wsInstances.length).toBe(2); // new WS created
  });

  it("does not reconnect after explicit disconnect", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();

    mgr.disconnect();
    // Close should not trigger reconnect
    expect(mgr.getState()).toBe("disconnected");
    vi.advanceTimersByTime(60000);
    expect(wsInstances.length).toBe(1); // no new WS
  });

  it("retries indefinitely – does not give up after many reconnect failures", () => {
    const mgr = getWebSocketManager();
    const errors: string[] = [];
    mgr.on("error", (e: string) => errors.push(e));

    mgr.connect();
    wsInstances[0]._simulateOpen();

    // Simulate 20 repeated failures – manager should keep reconnecting (RECONNECT_MAX_ATTEMPTS = Infinity)
    for (let i = 0; i < 20; i++) {
      const ws = wsInstances.at(-1)!;
      ws._simulateClose(1006);
      vi.advanceTimersByTime(60000); // past any backoff
    }

    // Manager must still be in reconnecting/connecting state, never give up
    expect(mgr.getState()).not.toBe("disconnected");
    expect(errors.some((e) => e.includes("Max reconnection"))).toBe(false);
  });

  // ---- Connection timeout ----
  it("handles connection timeout", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    // Don't open - let timeout fire (CONNECTION_TIMEOUT_MS = 30 000)
    vi.advanceTimersByTime(30100);
    expect(mgr.getState()).toBe("reconnecting");
  });

  // ---- Test isolation helpers ----
  it("setTestRunId/clearTestRunId manage test run ID", () => {
    const mgr = getWebSocketManager();
    mgr.setTestRunId("test-123");
    mgr.connect();
    expect(wsInstances[0].url).toContain("testRunId=test-123");

    // Simulate open so isConnecting resets, allowing a fresh connect() later
    wsInstances[0]._simulateOpen();

    mgr.clearTestRunId();
    mgr.disconnect();
    mgr.connect();
    const lastWs = wsInstances.at(-1)!;
    expect(lastWs.url).not.toContain("testRunId=test-123");
  });

  // ---- Buffer flush on disconnect ----
  it("drops buffered messages when flushing while disconnected", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();
    mgr.send({ type: "serial_input" as const, data: "buffered" });
    // Disconnect before flush
    mgr.disconnect();
    vi.advanceTimersByTime(50);
    // No error thrown, messages dropped
    expect(wsInstances[0].sentMessages.length).toBe(0);
  });

  // ---- Error in event handler ----
  it("catches errors in event handlers without breaking", () => {
    const mgr = getWebSocketManager();
    mgr.on("stateChange", () => {
      throw new Error("handler error");
    });
    // Should not throw
    expect(() => mgr.connect()).not.toThrow();
  });

  // ---- Multiple messages buffer flush logging ----
  it("flushes multiple buffered messages in one batch", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();

    mgr.send({ type: "serial_input" as const, data: "a" });
    mgr.send({ type: "serial_input" as const, data: "b" });
    mgr.send({ type: "serial_input" as const, data: "c" });

    vi.advanceTimersByTime(35);
    expect(wsInstances[0].sentMessages.length).toBe(3);
  });

  // ---- sendImmediate error handling ----
  it("handles send error in sendImmediate", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    const ws = wsInstances[0];
    ws._simulateOpen();
    // Make send throw
    ws.send = () => { throw new Error("send failed"); };
    const result = mgr.sendImmediate({ type: "serial_input" as const, data: "x" });
    expect(result).toBe(false);
  });

  // ---- Close code 1001 (normal) ----
  it("handles normal close (code 1001) without error log", () => {
    const mgr = getWebSocketManager();
    mgr.connect();
    wsInstances[0]._simulateOpen();
    wsInstances[0]._simulateClose(1001, "going away");
    expect(mgr.getState()).toBe("reconnecting");
  });
});

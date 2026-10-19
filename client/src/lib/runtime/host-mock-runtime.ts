import { wsMessageSchema, type WSMessage } from "@shared/schema";
import { getWebSocketManager } from "@/lib/websocket-manager";
import type { RuntimeEvent, RuntimeFeatures, SimulationRuntime, StartRequest } from "./simulation-runtime";

/** The WebSocket connection as the adapter needs it (the singleton manager in the app, a fake in tests). */
export interface HostMockTransport {
  /** Buffered send; false when the connection is not open. */
  send(message: WSMessage): boolean;
  /** Unbuffered send for time-critical messages. */
  sendImmediate(message: WSMessage): boolean;
  /** Raw incoming messages; returns the unsubscribe function. */
  onMessage(listener: (message: unknown) => void): () => void;
}

const RUNTIME_EVENT_TYPES: ReadonlySet<string> = new Set([
  "serial_output",
  "simulation_status",
  "pin_state_batch",
  "io_registry",
  "sim_telemetry",
  "operation_error",
  "compilation_status",
  "compilation_error",
]);

const isRuntimeEvent = (message: WSMessage): message is RuntimeEvent => RUNTIME_EVENT_TYPES.has(message.type);

export const HOST_MOCK_FEATURES: RuntimeFeatures = {
  serialInput: true,
  pause: true,
  resetWithoutCompile: false,
  survivesConnectionLoss: false,
};

/**
 * The server-side simulation behind the `SimulationRuntime` interface (plan
 * P3.3): it sends exactly the WebSocket messages the controllers send today
 * and passes the server's events on unchanged, so behavior stays as it is.
 */
export class HostMockRuntime implements SimulationRuntime {
  readonly kind = "host-mock" as const;
  readonly features = HOST_MOCK_FEATURES;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly unsubscribe: () => void;
  private lastStart: Extract<StartRequest, { kind: "host-mock" }> | undefined;

  constructor(private readonly transport: HostMockTransport) {
    this.unsubscribe = transport.onMessage((raw) => this.receive(raw));
  }

  start(request: StartRequest): void {
    if (request.kind !== "host-mock") throw new TypeError(`the host mock cannot start a ${request.kind} request`);
    this.lastStart = request;
    const message: WSMessage = {
      type: "start_simulation",
      timeout: request.timeoutSec,
      ...(request.code ? { code: request.code } : {}),
      ...(request.headers.length > 0 ? { headers: request.headers.map(({ name, content }) => ({ name, content })) } : {}),
      ...(request.entryFile ? { entryFile: request.entryFile } : {}),
    };
    this.sendUrgent(message);
  }

  pause(): void {
    this.transport.send({ type: "pause_simulation" });
  }

  resume(): void {
    this.transport.send({ type: "resume_simulation" });
  }

  stop(): void {
    this.sendUrgent({ type: "stop_simulation" });
  }

  /** The server has no CPU reset: stop and start the same code again. */
  reset(): void {
    const request = this.lastStart;
    this.stop();
    if (request) this.start(request);
  }

  sendSerial(text: string): void {
    this.transport.send({ type: "serial_input", data: text });
  }

  setPin(pin: number, value: number): void {
    this.transport.send({ type: "set_pin_value", pin, value });
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private sendUrgent(message: WSMessage): void {
    if (!this.transport.sendImmediate(message)) this.transport.send(message);
  }

  private receive(raw: unknown): void {
    const parsed = wsMessageSchema.safeParse(raw);
    if (!parsed.success || !isRuntimeEvent(parsed.data)) return;
    for (const listener of [...this.listeners]) listener(parsed.data);
  }
}

/** The host mock on the app's WebSocket connection. */
export function createHostMockRuntime(): HostMockRuntime {
  const manager = getWebSocketManager();
  return new HostMockRuntime({
    send: (message) => manager.send(message),
    sendImmediate: (message) => manager.sendImmediate(message),
    onMessage: (listener) => manager.on("message", listener),
  });
}

import type { WSMessage } from "@shared/schema";
import type { RuntimeKind } from "@shared/boards";
import { getWebSocketManager } from "@/lib/websocket-manager";
import { createHostMockRuntime } from "./host-mock-runtime";
import type { AnyRuntimeEvent, BrowserRuntimeEvent, RuntimeEvent, SimulationRuntime } from "./simulation-runtime";

export interface RuntimeHubOptions {
  createHostMock(): SimulationRuntime;
  /** Loads the browser runtime on demand, so the emulation code stays out of the initial bundle (plan P3.9). */
  createBrowser(): Promise<SimulationRuntime>;
  /** Where the browser runtime's events in the form of server messages go: the app's single message stream. */
  deliver(message: RuntimeEvent): void;
}

const BROWSER_ONLY_EVENTS: ReadonlySet<string> = new Set(["runtime_usage", "runtime_diagnostic", "runtime_telemetry"]);
/** The messages the browser runtime produces in the form of the server's: the server sends none of these during a browser run. */
const BROWSER_STREAM_TYPES: ReadonlySet<string> = new Set(["serial_output", "simulation_status", "pin_state_batch", "io_registry"]);
const isBrowserOnly = (event: AnyRuntimeEvent): event is BrowserRuntimeEvent => BROWSER_ONLY_EVENTS.has(event.type);

/**
 * The runtimes of a tab (plan P3.4). A tab has one active runtime and
 * changes it only while idle. The host mock's events already arrive through
 * the WebSocket connection; the browser runtime's are delivered into the same
 * stream, so the existing handler evaluates both, and its additional events
 * go to `onBrowserEvent` listeners.
 */
export class RuntimeHub {
  private readonly runtimes = new Map<RuntimeKind, SimulationRuntime>();
  private readonly browserListeners = new Set<(event: BrowserRuntimeEvent) => void>();
  private activeValue: RuntimeKind | undefined;
  private pendingBrowser: Promise<SimulationRuntime> | undefined;
  private browserRun = false;
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly options: RuntimeHubOptions) {}

  /** The runtime of the current or latest run; commands for a run go there. */
  get active(): RuntimeKind | undefined {
    return this.activeValue;
  }

  setActive(kind: RuntimeKind | undefined): void {
    this.activeValue = kind;
    this.setBrowserRun(kind === "browser");
  }

  /** True from the start of a browser run until the browser runtime reports it stopped; such a run needs no server connection. */
  get browserRunActive(): boolean {
    return this.browserRun;
  }

  /** True for a message of the run events the browser runtime feeds into the message stream while a browser run is the current run. */
  isBrowserEvent(message: { readonly type: string }): boolean {
    return this.activeValue === "browser" && BROWSER_STREAM_TYPES.has(message.type);
  }

  /** Notified when `browserRunActive` changes. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private setBrowserRun(value: boolean): void {
    if (this.browserRun === value) return;
    this.browserRun = value;
    for (const listener of this.changeListeners) listener();
  }

  /** The runtime if it exists; the browser runtime exists after `load("browser")`. */
  peek(kind: RuntimeKind): SimulationRuntime | undefined {
    if (kind === "host-mock" && !this.runtimes.has(kind)) this.runtimes.set(kind, this.options.createHostMock());
    return this.runtimes.get(kind);
  }

  /** The runtime, created (and for the browser, loaded) on first use. */
  async load(kind: RuntimeKind): Promise<SimulationRuntime> {
    const existing = this.peek(kind);
    if (existing) return existing;
    this.pendingBrowser ??= this.options.createBrowser().then((runtime) => {
      runtime.subscribe((event) => {
        if (event.type === "simulation_status" && event.status === "stopped" && this.activeValue === "browser") this.setBrowserRun(false);
        if (isBrowserOnly(event)) for (const listener of this.browserListeners) listener(event);
        else this.options.deliver(event);
      });
      this.runtimes.set("browser", runtime);
      return runtime;
    });
    return this.pendingBrowser;
  }

  /** Events only the browser runtime has: findings, diagnostics, telemetry. */
  onBrowserEvent(listener: (event: BrowserRuntimeEvent) => void): () => void {
    this.browserListeners.add(listener);
    return () => {
      this.browserListeners.delete(listener);
    };
  }

  dispose(): void {
    for (const runtime of this.runtimes.values()) runtime.dispose();
    this.runtimes.clear();
    this.browserListeners.clear();
    this.activeValue = undefined;
    this.pendingBrowser = undefined;
    this.changeListeners.clear();
  }
}

let hub: RuntimeHub | undefined;

/** The hub of this tab; the browser emulation's messages enter the WebSocket manager's message stream. */
export function getRuntimeHub(): RuntimeHub {
  hub ??= new RuntimeHub({
    createHostMock: createHostMockRuntime,
    createBrowser: async () => (await import("./browser-runtime")).createBrowserRuntime(),
    deliver: (message) => getWebSocketManager().injectMessage(message as WSMessage),
  });
  return hub;
}

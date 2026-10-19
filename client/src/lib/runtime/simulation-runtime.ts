import type { RuntimeKind } from "@shared/boards";
import type { ServerToClientWSMessage } from "@shared/schema";
import type { SimulationArtifact } from "@shared/simulation-artifact";

export type SourceHeader = { readonly name: string; readonly content: string };

/** What starting a run needs: the browser takes the compiled artifact, the host mock the source (plan 4.4). */
export type StartRequest =
  | { readonly kind: "browser"; readonly artifact: SimulationArtifact; readonly timeoutSec: number }
  | {
      readonly kind: "host-mock";
      readonly code: string;
      readonly headers: readonly SourceHeader[];
      readonly entryFile?: string;
      readonly timeoutSec: number;
    };

/** What a runtime can do; the UI enables its controls from this, not from the runtime's name. */
export interface RuntimeFeatures {
  readonly serialInput: boolean;
  readonly pause: boolean;
  /** `reset()` restarts the sketch without compiling again. */
  readonly resetWithoutCompile: boolean;
  /** The run continues while the connection to the server is down. */
  readonly survivesConnectionLoss: boolean;
}

/** Events in the form of the server's WebSocket messages; the existing handler evaluates them (plan 4.4). */
export type RuntimeEvent = Extract<
  ServerToClientWSMessage,
  {
    type:
      | "serial_output"
      | "simulation_status"
      | "pin_state_batch"
      | "io_registry"
      | "sim_telemetry"
      | "operation_error"
      | "compilation_status"
      | "compilation_error";
  }
>;

/**
 * A simulation backend as the client sees it. A tab has exactly one active
 * runtime and changes it only while idle. Events of a stopped, reset or
 * replaced run never reach `subscribe` listeners.
 */
export interface SimulationRuntime {
  readonly kind: RuntimeKind;
  readonly features: RuntimeFeatures;
  start(request: StartRequest): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Browser: CPU reset without compiling again; host mock: stop and start again. */
  reset(): void;
  sendSerial(text: string): void;
  /** Digital 0 or 1, analog 0–1023. */
  setPin(pin: number, value: number): void;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  dispose(): void;
}

import type { BoardId, RuntimeKind } from "@shared/boards";
import type { ServerToClientWSMessage } from "@shared/schema";
import type { SimulationArtifact } from "@shared/simulation-artifact";
import type { DiagnosticEvent, IoUsage, TelemetrySample } from "@unosim/avr-emulator/protocol";

export type SourceHeader = { readonly name: string; readonly content: string };

/** What starting a run needs: the browser takes the compiled artifact, the host mock the source (plan 4.4). */
export type StartRequest =
  | {
      readonly kind: "browser";
      readonly artifact: SimulationArtifact;
      /** The board selected in the UI; the worker refuses an artifact built for another board. Defaults to the artifact's board. */
      readonly board?: BoardId;
      readonly timeoutSec: number;
    }
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
 * Events only the browser runtime produces; the existing handler ignores them
 * until the packages that evaluate them (diagnostics and telemetry display,
 * I/O registry merge) are in place.
 */
export type BrowserRuntimeEvent =
  | { readonly type: "runtime_usage"; readonly usages: readonly IoUsage[] }
  | { readonly type: "runtime_diagnostic"; readonly diagnostic: DiagnosticEvent }
  | { readonly type: "runtime_telemetry"; readonly sample: TelemetrySample };

export type AnyRuntimeEvent = RuntimeEvent | BrowserRuntimeEvent;

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
  /** Serial input to a hardware serial port (0 = `Serial`, 1–3 = `Serial1`–`Serial3`); the host mock has port 0 only. */
  sendSerial(text: string, port?: number): void;
  /** Drives a digital input: 0 or 1 (the host mock also takes analog values here, as the controllers send them today). */
  setPin(pin: number, value: number): void;
  /** Analog input value 0–1023 on an analog pin. */
  setAnalog(pin: number, value: number): void;
  subscribe(listener: (event: AnyRuntimeEvent) => void): () => void;
  dispose(): void;
}

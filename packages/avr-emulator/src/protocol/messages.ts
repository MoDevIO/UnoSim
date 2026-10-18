import type { BoardHardwareId } from "../boards/ids";
import type { ImageSymbols } from "../image/simulation-image";
import type { DiagnosticEvent, StopReason } from "../runtime/emulator";
import type { IoUsage } from "../io/io-usage";
import type { PinSnapshot } from "../io/pin-model";

/** Version of the command and event types below; `ready` reports it, a change breaks old hosts. */
export const PROTOCOL_VERSION = 1;

/** Limits for incoming commands (plan 4.5, E8): the worker checks every command against them. */
export const COMMAND_LIMITS = {
  /** Wall-clock timeout of a run, 1–300 s like today (E8). */
  minTimeoutMs: 1_000,
  maxTimeoutMs: 300_000,
  maxPin: 255,
  maxAnalogValue: 1023,
  maxSerialPort: 3,
  /** Largest flash of any supported MCU (ATmega2560). */
  maxFlashBytes: 256 * 1024,
  maxBuildIdLength: 256,
} as const;

/** Commands from the UI to the worker; `load`, `start` and `reset` begin a new run (plan 4.5). */
export type Command =
  | {
      readonly type: "load";
      readonly runId: number;
      readonly board: BoardHardwareId;
      /** Identity of the build (E15), echoed in `ready`; the worker compares it with the selected board. */
      readonly buildId: string;
      readonly sha256: string;
      /** Flash content, transferred rather than copied. */
      readonly flash: ArrayBuffer;
      readonly symbols: ImageSymbols;
    }
  | { readonly type: "start"; readonly runId: number; readonly timeoutMs: number }
  | { readonly type: "pause" | "resume" | "stop" | "reset"; readonly runId: number }
  | { readonly type: "serialIn"; readonly runId: number; readonly port: number; readonly text: string }
  | { readonly type: "setDigital"; readonly runId: number; readonly pin: number; readonly level: 0 | 1 }
  | { readonly type: "setAnalog"; readonly runId: number; readonly pin: number; readonly value: number };

export type CommandType = Command["type"];

/** Commands that begin a new run and therefore carry a new `runId`. */
export const RUN_STARTING_COMMANDS: readonly CommandType[] = ["load", "start", "reset"];

export type RunStatus = "running" | "paused" | "stopped";

export interface TelemetrySample {
  readonly simTimeMs: number;
  readonly realTimeFactor: number;
  /** Pin changes per second of wall time since the previous telemetry event. */
  readonly pinChangesPerSecond: number;
  readonly serialCharsPerSecond: number;
  /** Serial characters dropped since the previous telemetry event because the UI could not keep up. */
  readonly serialCharsDropped: number;
}

/** Events from the worker to the UI, each tied to the `runId` it belongs to. */
export type WorkerEvent =
  | { readonly type: "ready"; readonly protocolVersion: number; readonly board: BoardHardwareId; readonly buildId: string }
  | { readonly type: "heartbeat"; readonly simTimeMs: number }
  | { readonly type: "status"; readonly state: RunStatus; readonly reason?: StopReason; readonly simTimeMs?: number; readonly wallTimeMs?: number }
  | { readonly type: "serial"; readonly port: number; readonly text: string }
  | { readonly type: "pins"; readonly changes: readonly PinSnapshot[]; readonly changeCount: number }
  | { readonly type: "usage"; readonly usages: readonly IoUsage[] }
  | ({ readonly type: "telemetry" } & TelemetrySample)
  | { readonly type: "diagnostic"; readonly diagnostic: DiagnosticEvent }
  | { readonly type: "fault"; readonly message: string };

export type WorkerEventType = WorkerEvent["type"];

/** An event with the run it belongs to; the UI discards events of any other run. */
export type RunEvent = WorkerEvent & { readonly runId: number };

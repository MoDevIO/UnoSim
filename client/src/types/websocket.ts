import { wsMessageSchema, type WSMessage, type ParserMessage, type IOPinRecord } from "@shared/schema";

export type IncomingArduinoMessage = WSMessage;

export type SerialPayload = Extract<WSMessage, { type: "serial_output" }>;
export type CompilationStatusPayload = Extract<WSMessage, { type: "compilation_status" }>;
export type CompilationErrorPayload = Extract<WSMessage, { type: "compilation_error" }>;
export type SimulationStatusPayload = Extract<WSMessage, { type: "simulation_status" }>;
export type PinStatePayload = Extract<WSMessage, { type: "pin_state" }>;
export type PinStateBatchPayload = Extract<WSMessage, { type: "pin_state_batch" }>;
export type IoRegistryPayload = Extract<WSMessage, { type: "io_registry" }>;
export type SimTelemetryPayload = Extract<WSMessage, { type: "sim_telemetry" }>;

/**
 * Type-guard for incoming socket messages.
 *
 * Useful when parsing untyped JSON from the WebSocket.
 */
export interface CompilerError {
  file: string;
  line: number;
  column: number;
  type: "error" | "warning";
  message: string;
}

export interface CompileConfig {
  code: string;
  headers?: Array<{ name: string; content: string }>;
  fqbn?: string;
  libraries?: string[];
}

export interface HexResult {
  success: boolean;
  raw?: string;
  error?: string;
}

export interface CompileResult {
  success: boolean;
  output?: string;
  stderr?: string;
  errors?: CompilerError[] | string;
  raw?: string;
  parserMessages?: ParserMessage[];
  ioRegistry?: IOPinRecord[];
  arduinoCliStatus?: "idle" | "compiling" | "success" | "error";
  cached?: boolean;
}

export function isArduinoMessage(value: unknown): value is WSMessage {
  return wsMessageSchema.safeParse(value).success;
}

export function isHexResult(value: unknown): value is HexResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (() => {
      const maybe = value as { success?: unknown };
      return typeof maybe.success === "boolean";
    })()
  );
}

export function isCompileResult(value: unknown): value is CompileResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (() => {
      const maybe = value as { success?: unknown };
      return typeof maybe.success === "boolean";
    })()
  );
}

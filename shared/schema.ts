import { z } from "zod";
import type { PinMode } from "./types/arduino.types";
import { INPUT_LIMITS, isSafeHeaderName } from "./input-limits";

// Sketch types (non-DB, for MemStorage)
export interface Sketch {
  id: string;
  name: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertSketch {
  name: string;
  content: string;
}

// Zod schema for validation
export const insertSketchSchema = z.object({
  name: z.string(),
  content: z.string(),
});

/** Runtime contract for the public REST compiler endpoint. */
export const compileRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    headers: z
      .array(
        z
          .object({
            name: z
              .string()
              .refine(isSafeHeaderName, "Header name must be a safe basename"),
            content: z
              .string()
              .max(INPUT_LIMITS.compile.maxHeaderContentChars),
          })
          .strict(),
      )
      .max(INPUT_LIMITS.compile.maxHeaders)
      .refine(
        (headers) =>
          new Set(headers.map((header) => header.name.toLowerCase())).size ===
          headers.length,
        "Header names must be unique",
      )
      .optional(),
    fqbn: z.string().min(1).max(INPUT_LIMITS.compile.maxFqbnChars).optional(),
    libraries: z
      .array(z.string().min(1).max(INPUT_LIMITS.compile.maxLibraryNameChars))
      .max(INPUT_LIMITS.compile.maxLibraries)
      .optional(),
  })
  .strict();

export type CompileRequest = z.infer<typeof compileRequestSchema>;

/**
 * Canonical WebSocket message type identifiers.
 *
 * Use this constant instead of inline string literals when constructing
 * messages. The literal type narrowing (via `as const`) keeps the
 * discriminated union in `wsMessageSchema` fully type-safe.
 *
 * Example:  sendMessageToClient(ws, { type: WSMessageType.SERIAL_OUTPUT, data })
 */
export const WSMessageType = {
  SERIAL_OUTPUT: "serial_output",
  SERIAL_INPUT: "serial_input",
  START_SIMULATION: "start_simulation",
  PAUSE_SIMULATION: "pause_simulation",
  RESUME_SIMULATION: "resume_simulation",
  STOP_SIMULATION: "stop_simulation",
  CODE_CHANGED: "code_changed",
  COMPILATION_ERROR: "compilation_error",
  COMPILATION_STATUS: "compilation_status",
  SIMULATION_STATUS: "simulation_status",
  HANDSHAKE: "handshake",
  PIN_STATE: "pin_state",
  PIN_STATE_BATCH: "pin_state_batch",
  SET_PIN_VALUE: "set_pin_value",
  IO_REGISTRY: "io_registry",
  SIM_TELEMETRY: "sim_telemetry",
} as const;

// WebSocket message types
export const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("serial_output"),
    data: z.string(),
    isComplete: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("serial_input"),
    data: z.string().max(INPUT_LIMITS.webSocket.maxSerialInputChars),
  }).strict(),
  z.object({
    type: z.literal("start_simulation"),
    timeout: z
      .number()
      .int()
      .min(INPUT_LIMITS.simulation.minTimeoutSeconds)
      .max(INPUT_LIMITS.simulation.maxTimeoutSeconds)
      .optional(),
    code: z.string().max(INPUT_LIMITS.compile.maxCodeChars).optional(),
  }).strict(),
  z.object({
    type: z.literal("pause_simulation"),
  }).strict(),
  z.object({
    type: z.literal("resume_simulation"),
  }).strict(),
  z.object({
    type: z.literal("stop_simulation"),
  }).strict(),
  z.object({
    type: z.literal("code_changed"),
  }).strict(),
  z.object({
    type: z.literal("compilation_error"),
    data: z.string(),
  }),
  z.object({
    type: z.literal("compilation_status"),
    arduinoCliStatus: z
      .enum(["idle", "compiling", "success", "error"])
      .optional(),
    gccStatus: z.enum(["idle", "compiling", "queued", "success", "error"]).optional(),
    sandboxMode: z.enum(["docker-sandbox", "local-limited"]).optional(),
    workerIndex: z.number().int().min(0).optional(),
    workerTotal: z.number().int().min(1).optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("simulation_status"),
    status: z.enum(["running", "stopped", "paused", "queued"]),
  }),
  z.object({
    type: z.literal("handshake"),
    testRunId: z.string(),
  }),
  z.object({
    type: z.literal("pin_state"),
    pin: z.number(),
    stateType: z.enum(["mode", "value", "pwm"]),
    value: z.number(),
  }),
  z.object({
    type: z.literal("pin_state_batch"),
    states: z.array(
      z.object({
        pin: z.number(),
        stateType: z.enum(["mode", "value", "pwm"]),
        value: z.number(),
      })
    ),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("set_pin_value"),
    pin: z
      .number()
      .int()
      .min(INPUT_LIMITS.simulation.minPin)
      .max(INPUT_LIMITS.simulation.maxPin),
    value: z.number().int().min(0).max(255),
  }).strict(),
  z.object({
    type: z.literal("io_registry"),
    registry: z.array(
      z.object({
        pin: z.string(),
        defined: z.boolean(),
        pinMode: z.number().optional(),
        definedAt: z
          .object({
            line: z.number(),
            loopContext: z
              .object({
                variable: z.string(),
                operator: z.string(),
                limit: z.number(),
                startLine: z.number(),
                endLine: z.number(),
              })
              .optional(),
          })
          .optional(),
        usedAt: z
          .array(
            z.object({
              line: z.number(),
              operation: z.string(),
              loopContext: z
                .object({
                  variable: z.string(),
                  operator: z.string(),
                  limit: z.number(),
                  startLine: z.number(),
                  endLine: z.number(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    ),
    baudrate: z.number().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("sim_telemetry"),
    metrics: z.object({
      timestamp: z.number(),
      intendedPinChangesPerSecond: z.number(),
      actualPinChangesPerSecond: z.number(),
      droppedPinChangesPerSecond: z.number(),
      batchesPerSecond: z.number(),
      avgStatesPerBatch: z.number(),
      serialOutputPerSecond: z.number(),
      serialBytesPerSecond: z.number(),
      serialBytesTotal: z.number(),
      serialIntendedBytesPerSecond: z.number(),
      serialDroppedBytesPerSecond: z.number(),
    }),
  }),
]);

export type WSMessage = z.infer<typeof wsMessageSchema>;

const CLIENT_TO_SERVER_MESSAGE_TYPES = [
  WSMessageType.SERIAL_INPUT,
  WSMessageType.START_SIMULATION,
  WSMessageType.PAUSE_SIMULATION,
  WSMessageType.RESUME_SIMULATION,
  WSMessageType.STOP_SIMULATION,
  WSMessageType.CODE_CHANGED,
  WSMessageType.SET_PIN_VALUE,
] as const;

type ClientToServerMessageType = (typeof CLIENT_TO_SERVER_MESSAGE_TYPES)[number];

/** Messages the browser is allowed to send to the simulation server. */
export type ClientToServerWSMessage = Extract<
  WSMessage,
  { type: ClientToServerMessageType }
>;

/** Messages emitted by the simulation server and consumed by the browser. */
export type ServerToClientWSMessage = Exclude<
  WSMessage,
  ClientToServerWSMessage
>;

export const clientToServerWSMessageSchema = wsMessageSchema.refine(
  (message): message is ClientToServerWSMessage =>
    CLIENT_TO_SERVER_MESSAGE_TYPES.includes(
      message.type as ClientToServerMessageType,
    ),
  { message: "Message type is not allowed from client to server" },
);

export const serverToClientWSMessageSchema = wsMessageSchema.refine(
  (message): message is ServerToClientWSMessage =>
    !CLIENT_TO_SERVER_MESSAGE_TYPES.includes(
      message.type as ClientToServerMessageType,
    ),
  { message: "Message type is not allowed from server to client" },
);

// Parser Message Types
export type ParserMessage = {
  id: string;
  type: "warning" | "error" | "info";
  category:
    | "serial"
    | "hardware"
    | "structure"
    | "performance"
    | "library"
    | "pins"
    | "reserved-name";
  severity: 1 | 2 | 3;
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
};

// I/O Pin Record for Registry Display
export interface IOPinRecord {
  pin: string;
  defined: boolean;
  // ── Numeric pin id (0-13 digital, 14-19 = A0-A5). Optional for compat. ──
  pinId?: number;
  // ── Per-operation line arrays (for extended / eye-on view) ───────────────
  pinModeLines?: Array<number | "runtime">;
  pinModeModes?: Array<PinMode>;
  digitalReadLines?: Array<number | "runtime">;
  digitalWriteLines?: Array<number | "runtime">;
  analogReadLines?: Array<number | "runtime">;
  analogWriteLines?: Array<number | "runtime">;
  // ── Conflict / warning flags (TC 9: write-on-input, TC 11: multi-mode) ───
  conflict?: boolean;
  conflictMessage?: string;
  // ── Legacy fields (kept for runtime path + backward compat) ─────────────
  pinMode?: number; // 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP
  definedAt?: {
    line: number;
    loopContext?: {
      variable: string;
      operator: string;
      limit: number;
      startLine: number;
      endLine: number;
    };
  };
  usedAt?: Array<{
    line: number;
    operation: string;
    loopContext?: {
      variable: string;
      operator: string;
      limit: number;
      startLine: number;
      endLine: number;
    };
  }>;
}

// Output line for serial monitor/plotter and compilation output
export interface OutputLine {
  text: string;
  complete: boolean;
}

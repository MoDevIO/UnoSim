import { z } from "zod";

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

// WebSocket message types
export const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("serial_output"),
    data: z.string(),
    isComplete: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("serial_input"),
    data: z.string(),
  }),
  z.object({
    type: z.literal("start_simulation"),
    timeout: z.number().optional(), // Timeout in seconds, 0 = infinite
  }),
  z.object({
    type: z.literal("pause_simulation"),
  }),
  z.object({
    type: z.literal("resume_simulation"),
  }),
  z.object({
    type: z.literal("stop_simulation"),
  }),
  z.object({
    type: z.literal("code_changed"),
  }),
  z.object({
    type: z.literal("compilation_error"),
    data: z.string(),
  }),
  z.object({
    type: z.literal("compilation_status"),
    arduinoCliStatus: z
      .enum(["idle", "compiling", "success", "error"])
      .optional(),
    gccStatus: z.enum(["idle", "compiling", "success", "error"]).optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("simulation_status"),
    status: z.enum(["running", "stopped", "paused"]),
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
    pin: z.number(),
    value: z.number(),
  }),
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
  pinModeModes?: Array<"INPUT" | "OUTPUT" | "INPUT_PULLUP">;
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

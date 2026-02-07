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
    type: z.literal("serial_event"),
    payload: z.object({
      type: z.string(),
      ts_write: z.number(),
      data: z.string(),
      baud: z.number().optional(),
      blocking: z.boolean().optional(),
      atomic: z.boolean().optional(),
    }),
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
      incomingEvents: z.number(),
      sentBatches: z.number(),
      eventsPerSecond: z.number(),
      batchEfficiency: z.number(),
      timestamp: z.number(),
      pinChangesPerSecond: z.number(),
      intendedPinChangesPerSecond: z.number(), // What the code tried to do
      actualPinChangesPerSecond: z.number(),   // What actually got through
      pinChangeLossPercentage: z.number(),     // Loss percentage
      isThrottled: z.boolean(),
      serialOutputPerSecond: z.number(),
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

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sketches = pgTable("sketches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
});

export const insertSketchSchema = createInsertSchema(sketches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSketch = z.infer<typeof insertSketchSchema>;
export type Sketch = typeof sketches.$inferSelect;

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
      baud: z.number(),
      bits_per_frame: z.number(),
      txBufferBefore: z.number().optional(),
      txBufferCapacity: z.number().optional(),
      blocking: z.boolean().optional(),
      atomic: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("start_simulation"),
    timeout: z.number().optional(), // Timeout in seconds, 0 = infinite
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
    arduinoCliStatus: z.enum(["idle", "compiling", "success", "error"]).optional(),
    gccStatus: z.enum(["idle", "compiling", "success", "error"]).optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("simulation_status"),
    status: z.enum(["running", "stopped"]),
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
    type: z.literal("parser_messages"),
    messages: z.array(z.object({
      id: z.string(),
      type: z.enum(['warning', 'error', 'info']),
      category: z.enum(['serial', 'hardware', 'structure', 'performance', 'library']),
      severity: z.enum([1, 2, 3] as const),
      line: z.number().optional(),
      column: z.number().optional(),
      message: z.string(),
      suggestion: z.string().optional(),
    })),
  }),
  z.object({
    type: z.literal("io_registry"),
    registry: z.array(z.object({
      pin: z.string(),
      defined: z.boolean(),
      pinMode: z.number().optional(),
      definedAt: z.object({
        line: z.number(),
        loopContext: z.object({
          variable: z.string(),
          operator: z.string(),
          limit: z.number(),
        }).optional(),
      }).optional(),
      usedAt: z.array(z.object({
        line: z.number(),
        operation: z.string(),
        loopContext: z.object({
          variable: z.string(),
          operator: z.string(),
          limit: z.number(),
        }).optional(),
      })).optional(),
    })),
  }),
]);

export type WSMessage = z.infer<typeof wsMessageSchema>;

// Parser Message Types
export const parserMessageSchema = z.object({
  id: z.string(),
  type: z.enum(['warning', 'error', 'info']),
  category: z.enum(['serial', 'hardware', 'structure', 'performance', 'library']),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  line: z.number().optional(),
  column: z.number().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
});

export type ParserMessage = z.infer<typeof parserMessageSchema>;

// Loop Context for I/O Registry
export interface LoopContext {
  variable: string;
  operator: string;
  limit: number;
  startLine: number;
  endLine: number;
}

// I/O Pin Record for Registry Display
export interface IOPinRecord {
  pin: string;
  defined: boolean;
  pinMode?: number;  // 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP
  definedAt?: { line: number; loopContext?: LoopContext };
  usedAt?: Array<{ line: number; operation: string; loopContext?: LoopContext }>;
}

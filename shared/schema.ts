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
    type: z.literal("start_simulation"),
  }),
  z.object({
    type: z.literal("stop_simulation"),
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
]);

export type WSMessage = z.infer<typeof wsMessageSchema>;

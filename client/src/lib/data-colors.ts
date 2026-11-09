/**
 * Data category colors (style guide, section 2): they tell categories of data apart and never carry a status.
 * A status uses `status-semantics.ts`; a category never borrows a status token. Every class here reaches at
 * least 4.5:1 on the background.
 */

/** Serial direction of a pin: RX and TX are data, TX is no error. */
export const SERIAL_DIRECTION_CLASS = { RX: "text-data-rx", TX: "text-data-tx" } as const;

/** Pin modes in the I/O Registry: INPUT, OUTPUT, and the pull-up variants. */
export const PIN_MODE_CLASS = { input: "text-blue-400", output: "text-orange-400", other: "text-green-400" } as const;

/** Marks: a PWM-capable pin (~), a record seen only at run time, and a source line reference. */
export const DATA_MARK_CLASS = { pwm: "text-yellow-400", runtime: "text-yellow-400", sourceLine: "text-blue-400", pin: "text-cyan-400" } as const;

/** Debug messages: who sent them, over which protocol, and of which type. */
export const DEBUG_SENDER_TEXT_CLASS: Readonly<Record<string, string>> = { server: "text-blue-400", browser: "text-cyan-400", frontend: "text-green-400" };
export const DEBUG_SENDER_BADGE_CLASS: Readonly<Record<string, string>> = {
  server: "bg-blue-600/20 text-blue-400",
  browser: "bg-cyan-600/20 text-cyan-400",
  frontend: "bg-green-600/20 text-green-400",
};
export const DEBUG_PROTOCOL_CLASS = { http: "text-orange-400", worker: "text-cyan-400", websocket: "text-purple-400" } as const;
export const DEBUG_FIELD_CLASS = { type: "text-yellow-400", typeBadge: "bg-yellow-600/10 text-yellow-400", timestamp: "text-cyan-400" } as const;

/** File types in the sketch tabs. */
export const FILE_TYPE_CLASS = { sketch: "text-teal-600", header: "text-purple-400" } as const;

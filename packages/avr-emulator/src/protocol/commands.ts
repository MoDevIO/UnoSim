import { isBoardHardwareId } from "../boards/ids";
import type { ImageSymbols } from "../image/simulation-image";
import { SERIAL_INPUT_LIMITS } from "../io/serial-ports";
import { encodeUtf8 } from "../io/utf8";
import { COMMAND_LIMITS, type Command } from "./messages";

export type CommandResult = { readonly ok: true; readonly command: Command } | { readonly ok: false; readonly reason: string };

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const isInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

type Fields = Record<string, unknown>;

const parserTable: Record<Command["type"], (fields: Fields, runId: number) => CommandResult> = {
  load(fields, runId) {
    const { board, artifactBoard, buildId, sha256, flash, symbols } = fields;
    if (!isBoardHardwareId(board) || !isBoardHardwareId(artifactBoard)) return fail("unknown board");
    if (typeof buildId !== "string" || buildId.length === 0 || buildId.length > COMMAND_LIMITS.maxBuildIdLength) return fail("invalid buildId");
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return fail("invalid sha256");
    if (!(flash instanceof ArrayBuffer) || flash.byteLength === 0 || flash.byteLength > COMMAND_LIMITS.maxFlashBytes) return fail("invalid flash");
    if (!isObject(symbols)) return fail("invalid symbols");
    return { ok: true, command: { type: "load", runId, board, artifactBoard, buildId, sha256, flash, symbols: symbols as unknown as ImageSymbols } };
  },
  start(fields, runId) {
    const { timeoutMs, serialBaud } = fields;
    if (!isInteger(timeoutMs, COMMAND_LIMITS.minTimeoutMs, COMMAND_LIMITS.maxTimeoutMs)) return fail("invalid timeoutMs");
    if (serialBaud !== undefined && !isInteger(serialBaud, COMMAND_LIMITS.minSerialBaud, COMMAND_LIMITS.maxSerialBaud)) return fail("invalid serialBaud");
    return { ok: true, command: { type: "start", runId, timeoutMs, ...(serialBaud === undefined ? {} : { serialBaud }) } };
  },
  pause: (_fields, runId) => ({ ok: true, command: { type: "pause", runId } }),
  resume: (_fields, runId) => ({ ok: true, command: { type: "resume", runId } }),
  stop: (_fields, runId) => ({ ok: true, command: { type: "stop", runId } }),
  reset: (_fields, runId) => ({ ok: true, command: { type: "reset", runId } }),
  serialIn(fields, runId) {
    const { port, text } = fields;
    if (!isInteger(port, 0, COMMAND_LIMITS.maxSerialPort)) return fail("invalid port");
    if (typeof text !== "string" || text.length === 0) return fail("invalid text");
    // Every UTF-16 unit needs at least one byte, so a longer string is too long without encoding it.
    if (text.length > SERIAL_INPUT_LIMITS.maxMessageBytes || encodeUtf8(text).length > SERIAL_INPUT_LIMITS.maxMessageBytes) return fail("text too long");
    return { ok: true, command: { type: "serialIn", runId, port, text } };
  },
  setDigital(fields, runId) {
    const { pin, level } = fields;
    if (!isInteger(pin, 0, COMMAND_LIMITS.maxPin)) return fail("invalid pin");
    if (level !== 0 && level !== 1) return fail("invalid level");
    return { ok: true, command: { type: "setDigital", runId, pin, level } };
  },
  setAnalog(fields, runId) {
    const { pin, value } = fields;
    if (!isInteger(pin, 0, COMMAND_LIMITS.maxPin)) return fail("invalid pin");
    if (!isInteger(value, 0, COMMAND_LIMITS.maxAnalogValue)) return fail("invalid value");
    return { ok: true, command: { type: "setAnalog", runId, pin, value } };
  },
};

/** Looked up by `get`, so names inherited from Object (`constructor`) are not commands. */
const parsers = new Map(Object.entries(parserTable));

/**
 * Validates an incoming message against the command schema (plan 4.5). The
 * worker discards messages that fail; unknown fields are ignored, unknown
 * types and out-of-range values fail. Pins are checked against the board by
 * the host (a pin the board does not have is refused there).
 */
export function parseCommand(message: unknown): CommandResult {
  if (!isObject(message)) return fail("message must be an object");
  const { type, runId } = message;
  const parser = typeof type === "string" ? parsers.get(type) : undefined;
  if (!parser) return fail("unknown command");
  if (!isInteger(runId, 0, Number.MAX_SAFE_INTEGER)) return fail("invalid runId");
  return parser(message, runId);
}

/** Line endings of the Arduino IDE serial monitor; the IDE appends the chosen one to everything it sends. */
export const SERIAL_LINE_ENDINGS = [
  { id: "none", label: "No line ending", suffix: "" },
  { id: "lf", label: "Newline", suffix: "\n" },
  { id: "cr", label: "Carriage return", suffix: "\r" },
  { id: "crlf", label: "Both NL & CR", suffix: "\r\n" },
] as const;

export type SerialLineEndingId = (typeof SERIAL_LINE_ENDINGS)[number]["id"];

export const SERIAL_LINE_ENDING_KEY = "unoSerialLineEnding";
export const DEFAULT_SERIAL_LINE_ENDING: SerialLineEndingId = "lf";

export function isSerialLineEndingId(value: unknown): value is SerialLineEndingId {
  return SERIAL_LINE_ENDINGS.some((ending) => ending.id === value);
}

export function getSerialLineEndingId(): SerialLineEndingId {
  try {
    const stored = globalThis.localStorage.getItem(SERIAL_LINE_ENDING_KEY);
    return isSerialLineEndingId(stored) ? stored : DEFAULT_SERIAL_LINE_ENDING;
  } catch {
    return DEFAULT_SERIAL_LINE_ENDING;
  }
}

export function setSerialLineEndingId(id: SerialLineEndingId): void {
  try {
    globalThis.localStorage.setItem(SERIAL_LINE_ENDING_KEY, id);
  } catch {
    // storage blocked: the choice then lasts only until the page is reloaded
  }
}

/** The text appended to what the serial monitor sends, as chosen in the settings. */
export function getSerialLineEnding(): string {
  const id = getSerialLineEndingId();
  return SERIAL_LINE_ENDINGS.find((ending) => ending.id === id)?.suffix ?? "";
}

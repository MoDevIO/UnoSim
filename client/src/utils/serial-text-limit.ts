/**
 * The serial monitor keeps the last part of what the sketch printed, not all of it: a sketch without `delay()`
 * prints as fast as the emulation runs (about 11 KB/s at 115200 baud), and a text that grows without bound
 * makes every update slower until the tab runs out of memory. Every update copies and splits this text, so it
 * stays small: about 4000 lines of typical output.
 */
export const SERIAL_TEXT_KEEP_CHARS = 40_000;
/** Trimming costs a copy, so it waits until the text is this much longer than it has to be. */
const SERIAL_TEXT_SLACK_CHARS = 10_000;

/**
 * Returns `text` unchanged while it is short enough; beyond the limit it returns the last
 * `SERIAL_TEXT_KEEP_CHARS` characters, starting at the beginning of a line.
 */
export function limitSerialText(text: string): string {
  if (text.length <= SERIAL_TEXT_KEEP_CHARS + SERIAL_TEXT_SLACK_CHARS) return text;
  const tail = text.slice(-SERIAL_TEXT_KEEP_CHARS);
  const lineStart = tail.indexOf("\n");
  return lineStart === -1 ? tail : tail.slice(lineStart + 1);
}

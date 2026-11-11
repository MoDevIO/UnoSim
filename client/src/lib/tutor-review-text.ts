/**
 * Text rules the Tutor review export renders with, and the size bound the capture reserves by. Both live here
 * so the bound follows exactly the rendering the export uses.
 */

const encoder = new TextEncoder();
export const utf8Bytes = (value: string): number => encoder.encode(value).length;

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;

/** Control characters other than line break and tab become visible markers, so they cannot shape the frame. */
export function visible(value: string): string {
  return value.replaceAll(CONTROL, (character) =>
    `⟦U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧`);
}

/**
 * Per value in the export: its label line in the protocol, and key, indentation and punctuation in the
 * pretty-printed JSON. Nesting stays below eight levels, so 16 indentation bytes plus labels fit.
 */
const NODE_BYTES = 128;
/** Per line break inside a text: the line break, at most six indentation spaces and the `  | ` prefix. */
const LINE_BREAK_BYTES = 12;

function lineBreaks(value: string): number {
  let count = 0;
  for (let index = value.indexOf("\n"); index >= 0; index = value.indexOf("\n", index + 1)) count++;
  return count;
}

/**
 * An upper bound of the UTF-8 bytes `value` adds to the export, which shows each text once as readable,
 * marked and prefixed lines and once as escaped JSON. It walks the value iteratively, so deep or long
 * inputs cannot exhaust the stack.
 */
export function tutorReviewExportBytes(value: unknown): number {
  let bytes = 0;
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    bytes += NODE_BYTES;
    if (typeof item === "string") {
      bytes += utf8Bytes(JSON.stringify(item)) + utf8Bytes(visible(item)) + LINE_BREAK_BYTES * lineBreaks(item);
    } else if (Array.isArray(item)) {
      for (const entry of item) pending.push(entry);
    } else if (item !== null && typeof item === "object") {
      for (const [key, entry] of Object.entries(item)) {
        bytes += 2 * utf8Bytes(key);
        pending.push(entry);
      }
    } else {
      bytes += 2 * String(item).length;
    }
  }
  return bytes;
}

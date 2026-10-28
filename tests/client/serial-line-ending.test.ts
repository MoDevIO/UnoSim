import { afterEach, describe, expect, it } from "vitest";
import {
  SERIAL_LINE_ENDING_KEY,
  getSerialLineEnding,
  getSerialLineEndingId,
  setSerialLineEndingId,
} from "@/lib/serial-line-ending";

describe("serial line ending", () => {
  afterEach(() => globalThis.localStorage.removeItem(SERIAL_LINE_ENDING_KEY));

  it("is Newline until another one is chosen, like the Arduino IDE", () => {
    expect(getSerialLineEndingId()).toBe("lf");
    expect(getSerialLineEnding()).toBe("\n");
  });

  it.each([["none", ""], ["lf", "\n"], ["cr", "\r"], ["crlf", "\r\n"]] as const)("appends %j as %j", (id, suffix) => {
    setSerialLineEndingId(id);

    expect(getSerialLineEnding()).toBe(suffix);
  });

  it("falls back to Newline for a stored value it does not know", () => {
    globalThis.localStorage.setItem(SERIAL_LINE_ENDING_KEY, "tab");

    expect(getSerialLineEnding()).toBe("\n");
  });
});

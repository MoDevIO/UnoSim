import { describe, expect, it } from "vitest";
import { SERIAL_TEXT_KEEP_CHARS, limitSerialText } from "../../../client/src/utils/serial-text-limit";

describe("limitSerialText", () => {
  it("leaves a text alone while it is within the limit plus slack", () => {
    const text = "line\n".repeat(10_000); // 50,000 characters
    expect(limitSerialText(text)).toBe(text);
    expect(limitSerialText("")).toBe("");
  });

  it("keeps about the last 40,000 characters, starting at the beginning of a line", () => {
    const lines = Array.from({ length: 20_000 }, (_, index) => `n=${index}`);
    const text = `${lines.join("\n")}\n`;

    const limited = limitSerialText(text);

    expect(limited.length).toBeLessThanOrEqual(SERIAL_TEXT_KEEP_CHARS);
    expect(limited.length).toBeGreaterThan(SERIAL_TEXT_KEEP_CHARS - 20);
    expect(limited.endsWith("n=19999\n")).toBe(true);
    expect(limited.startsWith("n=")).toBe(true);
    expect(text.endsWith(limited)).toBe(true);
  });

  it("keeps the tail of a text without any line break", () => {
    expect(limitSerialText("x".repeat(100_000))).toHaveLength(SERIAL_TEXT_KEEP_CHARS);
  });

  it("stays bounded when output arrives as a flood of small pieces", () => {
    let text = "";
    for (let index = 0; index < 200_000; index++) text = limitSerialText(`${text}${index}\n`);

    expect(text.length).toBeLessThanOrEqual(SERIAL_TEXT_KEEP_CHARS + 10_000);
    expect(text.endsWith("199999\n")).toBe(true);
  });
});

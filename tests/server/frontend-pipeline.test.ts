/**
 * This test simulates the EXACT frontend processing pipeline to debug
 * why backspace doesn't work correctly in the real app.
 */
import { describe, it, expect } from "vitest";
import { applyBackspaceAcrossLines } from "../../client/src/components/features/serial-monitor";
import type { OutputLine } from "../../shared/schema";

/**
 * Strips leading backspace characters from text and removes corresponding
 * characters from the last incomplete line.
 */
function handleBackspacePrefix(text: string, newLines: OutputLine[]): string {
  if (!text.includes("\b")) return text;

  let backspaceCount = 0;
  let idx = 0;
  while (idx < text.length && text[idx] === "\b") {
    backspaceCount++;
    idx++;
  }

  if (backspaceCount > 0 && newLines.length > 0 && !newLines.at(-1).complete) {
    const lastLine = newLines.at(-1);
    lastLine.text = lastLine.text.slice(
      0,
      Math.max(0, lastLine.text.length - backspaceCount),
    );
  }

  return text.slice(backspaceCount);
}

/**
 * Appends text as an incomplete line (no newline at end).
 */
function appendIncompleteText(text: string, newLines: OutputLine[]): void {
  if (newLines.length === 0 || newLines.at(-1).complete) {
    newLines.push({ text, complete: false });
  } else {
    newLines.at(-1).text += text;
  }
}

/**
 * Appends text and marks the line as complete (newline at end).
 */
function appendCompleteText(text: string, newLines: OutputLine[]): void {
  if (newLines.length === 0 || newLines.at(-1).complete) {
    newLines.push({ text, complete: true });
  } else {
    newLines.at(-1).text += text;
    newLines.at(-1).complete = true;
  }
}

/**
 * Simulates processSerialEvents from arduino-simulator.tsx
 */
function processSerialEvents(
  events: Array<{ payload: { data: string } }>,
  currentLines: OutputLine[],
): OutputLine[] {
  const newLines: OutputLine[] = [...currentLines];

  for (const { payload } of events) {
    const text = handleBackspacePrefix(
      (payload.data || "").toString(),
      newLines,
    );
    if (!text) continue;

    if (text.includes("\n")) {
      const pos = text.indexOf("\n");
      appendCompleteText(text.slice(0, Math.max(0, pos)), newLines);

      const afterNewline = text.slice(Math.max(0, pos + 1));
      if (afterNewline) {
        newLines.push({ text: afterNewline, complete: false });
      }
    } else {
      appendIncompleteText(text, newLines);
    }
  }

  return newLines;
}

/**
 * Simulates SerialMonitor's useEffect processing
 */
function renderSerialMonitor(output: OutputLine[]): string[] {
  const lines: Array<{ text: string; incomplete: boolean }> = [];

  output.forEach((line) => {
    let text = line.text;

    // Handle backspace across line boundaries
    const backspaceResult = applyBackspaceAcrossLines(
      lines,
      text,
      line.complete ?? true,
    );
    if (backspaceResult === null) {
      return; // handled fully
    }
    text = backspaceResult;

    // Normal text processing would happen here
    if (text) {
      lines.push({ text, incomplete: !line.complete });
    }
  });

  return lines.map((l) => l.text);
}

describe("Frontend Pipeline Simulation", () => {
  it("should correctly process backspace sequence step by step", () => {
    // Simulate events arriving one by one (as they would from backend)
    let serialOutput: OutputLine[] = [];

    // Event 1: "Counting: 1"
    serialOutput = processSerialEvents(
      [{ payload: { data: "Counting: 1" } }],
      serialOutput,
    );
    let rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(["Counting: 1"]);

    // Event 2: "\b2"
    serialOutput = processSerialEvents(
      [{ payload: { data: "\b2" } }],
      serialOutput,
    );
    rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(["Counting: 2"]);

    // Event 3: "\b3"
    serialOutput = processSerialEvents(
      [{ payload: { data: "\b3" } }],
      serialOutput,
    );
    rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(["Counting: 3"]);

    // Event 4: "\b4"
    serialOutput = processSerialEvents(
      [{ payload: { data: "\b4" } }],
      serialOutput,
    );
    rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(["Counting: 4"]);
  });

  it("should handle batched events (coalesced by backend)", () => {
    // If backend coalesces "\b3" and "\b4" into one batch
    let serialOutput: OutputLine[] = [];

    serialOutput = processSerialEvents(
      [{ payload: { data: "Counting: 1" } }],
      serialOutput,
    );

    serialOutput = processSerialEvents(
      [{ payload: { data: "\b2" } }],
      serialOutput,
    );

    // Batched: both \b3 and \b4 arrive together
    serialOutput = processSerialEvents(
      [{ payload: { data: "\b3" } }, { payload: { data: "\b4" } }],
      serialOutput,
    );

    const rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(["Counting: 4"]);
  });

  it("should handle all events batched together", () => {
    // Worst case: all events arrive in one batch
    const serialOutput = processSerialEvents(
      [
        { payload: { data: "Counting: 1" } },
        { payload: { data: "\b2" } },
        { payload: { data: "\b3" } },
        { payload: { data: "\b4" } },
      ],
      [],
    );

    const rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(["Counting: 4"]);
  });
});

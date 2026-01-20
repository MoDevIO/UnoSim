/**
 * This test simulates the EXACT frontend processing pipeline to debug
 * why backspace doesn't work correctly in the real app.
 */
import { describe, it, expect } from '@jest/globals';
import { applyBackspaceAcrossLines } from '../../client/src/components/features/serial-monitor';
import type { OutputLine } from '../../shared/schema';

/**
 * Simulates processSerialEvents from arduino-simulator.tsx
 */
function processSerialEvents(
  events: Array<{payload: {data: string}}>,
  currentLines: OutputLine[]
): OutputLine[] {
  let newLines: OutputLine[] = [...currentLines];

  for (const { payload } of events) {
    const piece: string = (payload.data || '').toString();
    
    // Handle backspace at the start of this piece - apply to previous line
    let text = piece;
    if (text.includes('\b')) {
      let backspaceCount = 0;
      let idx = 0;
      while (idx < text.length && text[idx] === '\b') {
        backspaceCount++;
        idx++;
      }
      
      if (backspaceCount > 0 && newLines.length > 0 && !newLines[newLines.length - 1].complete) {
        // Remove characters from the last incomplete line
        const lastLine = newLines[newLines.length - 1];
        lastLine.text = lastLine.text.slice(0, Math.max(0, lastLine.text.length - backspaceCount));
        text = text.slice(backspaceCount);
      }
    }

    // Process remaining text
    if (!text) continue;

    // Check for newlines
    if (text.includes('\n')) {
      const pos = text.indexOf('\n');
      const beforeNewline = text.substring(0, pos);
      const afterNewline = text.substring(pos + 1);

      // Append text before newline to current line and mark complete
      if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
        newLines.push({ text: beforeNewline, complete: true });
      } else {
        newLines[newLines.length - 1].text += beforeNewline;
        newLines[newLines.length - 1].complete = true;
      }

      // Handle text after newline
      if (afterNewline) {
        newLines.push({ text: afterNewline, complete: false });
      }
    } else {
      // No newline - append to last incomplete line or create new
      if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
        newLines.push({ text: text, complete: false });
      } else {
        newLines[newLines.length - 1].text += text;
      }
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
    const backspaceResult = applyBackspaceAcrossLines(lines, text, line.complete ?? true);
    if (backspaceResult === null) {
      return; // handled fully
    }
    text = backspaceResult;

    // Normal text processing would happen here
    if (text) {
      lines.push({ text, incomplete: !line.complete });
    }
  });

  return lines.map(l => l.text);
}

describe('Frontend Pipeline Simulation', () => {
  it('should correctly process backspace sequence step by step', () => {
    // Simulate events arriving one by one (as they would from backend)
    let serialOutput: OutputLine[] = [];
    
    // Event 1: "Counting: 1"
    serialOutput = processSerialEvents(
      [{ payload: { data: 'Counting: 1' } }],
      serialOutput
    );
    let rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(['Counting: 1']);
    
    // Event 2: "\b2"
    serialOutput = processSerialEvents(
      [{ payload: { data: '\b2' } }],
      serialOutput
    );
    rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(['Counting: 2']);
    
    // Event 3: "\b3"
    serialOutput = processSerialEvents(
      [{ payload: { data: '\b3' } }],
      serialOutput
    );
    rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(['Counting: 3']);
    
    // Event 4: "\b4"
    serialOutput = processSerialEvents(
      [{ payload: { data: '\b4' } }],
      serialOutput
    );
    rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(['Counting: 4']);
  });

  it('should handle batched events (coalesced by backend)', () => {
    // If backend coalesces "\b3" and "\b4" into one batch
    let serialOutput: OutputLine[] = [];
    
    serialOutput = processSerialEvents(
      [{ payload: { data: 'Counting: 1' } }],
      serialOutput
    );
    
    serialOutput = processSerialEvents(
      [{ payload: { data: '\b2' } }],
      serialOutput
    );
    
    // Batched: both \b3 and \b4 arrive together
    serialOutput = processSerialEvents(
      [
        { payload: { data: '\b3' } },
        { payload: { data: '\b4' } }
      ],
      serialOutput
    );
    
    const rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(['Counting: 4']);
  });

  it('should handle all events batched together', () => {
    // Worst case: all events arrive in one batch
    const serialOutput = processSerialEvents(
      [
        { payload: { data: 'Counting: 1' } },
        { payload: { data: '\b2' } },
        { payload: { data: '\b3' } },
        { payload: { data: '\b4' } }
      ],
      []
    );
    
    const rendered = renderSerialMonitor(serialOutput);
    expect(rendered).toEqual(['Counting: 4']);
  });
});

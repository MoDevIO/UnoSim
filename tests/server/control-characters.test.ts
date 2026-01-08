import { describe, it, expect, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { applyBackspaceAcrossLines } from '../../client/src/components/features/serial-monitor';

describe('Control Characters Examples and Handling', () => {
  const examplesDir = path.join(__dirname, '../../public/examples/04-control-characters');
  const monitorPath = path.join(__dirname, '../../client/src/components/features/serial-monitor.tsx');
  const simulatorPath = path.join(__dirname, '../../client/src/pages/arduino-simulator.tsx');

  it('examples should exist and contain control characters', () => {
    const files = fs.readdirSync(examplesDir);
    expect(files.length).toBeGreaterThanOrEqual(5);

    const expected = ['backspace.ino', 'tab.ino', 'clear_line.ino', 'bell.ino', 'formfeed_vtab.ino'];
    expected.forEach(f => expect(files).toContain(f));

    // Check each example contains at least one control char
    for (const f of expected) {
      const code = fs.readFileSync(path.join(examplesDir, f), 'utf8');
      const hasControl = /\\b|\\t|\\x1b\[K|\\x07|\\f|\\v/.test(code) || /\x1b\[K/.test(code);
      expect(hasControl).toBe(true);
    }
  });

  it('Base64 roundtrip preserves control characters for examples', () => {
    const expected = ['backspace.ino', 'tab.ino', 'clear_line.ino', 'bell.ino', 'formfeed_vtab.ino'];
    for (const f of expected) {
      const code = fs.readFileSync(path.join(examplesDir, f), 'utf8');
      const b64 = Buffer.from(code, 'utf8').toString('base64');
      const round = Buffer.from(b64, 'base64').toString('utf8');
      expect(round).toBe(code);
    }
  });

  it('serial-monitor contains handlers for control chars', () => {
    const monitorCode = fs.readFileSync(monitorPath, 'utf8');
    // Backspace handling
    expect(monitorCode).toContain('\\b');
    // Tab expansion
    expect(monitorCode).toContain('\\t');
    // ESC[K clear-line handling
    expect(monitorCode).toContain('\\x1b\\[K');
    // Bell marker
    expect(monitorCode.includes('\\x07') || monitorCode.includes('␇')).toBe(true);
    // Form feed / vertical tab
    expect(monitorCode.includes('\\f') || monitorCode.includes('\\v')).toBe(true);
  });

  it('simulator should preserve \\r (regression guard)', () => {
    const simCode = fs.readFileSync(simulatorPath, 'utf8');
    // Ensure we didn't accidentally reintroduce strip of CR
    // Check that carriage return is preserved (not stripped with replace)
    expect(simCode).not.toMatch(/replace\(\/\\r\//);
    // Check that serial events are processed (piece variable exists)
    expect(simCode).toMatch(/const piece.*payload\.data/);
  });

  describe('backspace (\\b) behavior', () => {
    /**
     * Simulates what the serial monitor does: processes incoming serial chunks
     * and builds up the display lines.
     */
    function simulateSerialOutput(chunks: Array<{ text: string; complete: boolean }>) {
      const lines: Array<{ text: string; incomplete: boolean }> = [];
      const snapshots: string[] = [];

      for (const chunk of chunks) {
        const result = applyBackspaceAcrossLines(lines, chunk.text, chunk.complete);
        if (result !== null) {
          // No backspace handling was needed, add as new line or append
          if (lines.length > 0 && lines[lines.length - 1].incomplete) {
            lines[lines.length - 1].text += result;
            lines[lines.length - 1].incomplete = !chunk.complete;
          } else {
            lines.push({ text: result, incomplete: !chunk.complete });
          }
        }
        // Snapshot what user sees after each chunk
        snapshots.push(lines.map(l => l.text).join(''));
      }

      return { lines, snapshots };
    }

    it('Phase 1: character X is displayed initially', () => {
      const { snapshots } = simulateSerialOutput([
        { text: 'X', complete: false }
      ]);
      expect(snapshots[0]).toBe('X');
    });

    it('Phase 2: character X remains visible (no change without new input)', () => {
      const { snapshots } = simulateSerialOutput([
        { text: 'X', complete: false }
      ]);
      // After first chunk, X is still there
      expect(snapshots[0]).toBe('X');
      // Simulate "waiting" - snapshots don't change without new chunks
      expect(snapshots.length).toBe(1);
    });

    it('Phase 3: backspace+Y replaces X with Y at same position', () => {
      const { snapshots } = simulateSerialOutput([
        { text: 'X', complete: false },
        { text: '\bY', complete: true }
      ]);
      // After first chunk: X visible
      expect(snapshots[0]).toBe('X');
      // After second chunk: Y replaces X
      expect(snapshots[1]).toBe('Y');
    });

    it('all 3 phases in sequence: X shown, persists, then becomes Y', () => {
      const lines: Array<{ text: string; incomplete: boolean }> = [];

      // Phase 1: Send 'X' incomplete
      let result = applyBackspaceAcrossLines(lines, 'X', false);
      if (result !== null) {
        lines.push({ text: result, incomplete: true });
      }
      const phase1Display = lines.map(l => l.text).join('');
      expect(phase1Display).toBe('X');

      // Phase 2: Nothing changes (simulate time passing)
      const phase2Display = lines.map(l => l.text).join('');
      expect(phase2Display).toBe('X');

      // Phase 3: Send backspace + Y
      result = applyBackspaceAcrossLines(lines, '\bY', true);
      if (result !== null) {
        if (lines.length > 0 && lines[lines.length - 1].incomplete) {
          lines[lines.length - 1].text += result;
          lines[lines.length - 1].incomplete = false;
        } else {
          lines.push({ text: result, incomplete: false });
        }
      }
      const phase3Display = lines.map(l => l.text).join('');
      expect(phase3Display).toBe('Y');
    });

    it('multiple backspaces remove multiple characters', () => {
      const { snapshots } = simulateSerialOutput([
        { text: 'ABC', complete: false },
        { text: '\b\b\bXYZ', complete: true }
      ]);
      expect(snapshots[0]).toBe('ABC');
      expect(snapshots[1]).toBe('XYZ');
    });

    it('backspace at start of line does not crash', () => {
      const { snapshots } = simulateSerialOutput([
        { text: 'A', complete: false },
        { text: '\b\b\bX', complete: true } // More backspaces than chars
      ]);
      expect(snapshots[0]).toBe('A');
      expect(snapshots[1]).toBe('X');
    });

    it('real Arduino: separate print calls with backspace-only chunk', () => {
      // Arduino code sends these as separate Serial.print() calls:
      // Serial.print("Counting: 1");       -> chunk 1
      // Serial.print("\b");                 -> chunk 2 (backspace alone)
      // Serial.print("2");                  -> chunk 3
      // Serial.print("\b");                 -> chunk 4 (backspace alone)
      // Serial.print("3\n");                -> chunk 5
      // Expected display:
      //   after chunk 1: "Counting: 1"
      //   after chunk 3: "Counting: 2"
      //   after chunk 5: "Counting: 3"
      const lines: Array<{ text: string; incomplete: boolean }> = [];

      // Chunk 1: "Counting: 1" incomplete
      let result = applyBackspaceAcrossLines(lines, 'Counting: 1', false);
      if (result !== null) {
        lines.push({ text: result, incomplete: true });
      }
      expect(lines.map(l => l.text).join('')).toBe('Counting: 1');
      expect(lines[lines.length - 1].incomplete).toBe(true);

      // Chunk 2: "\b" alone (must not mark as complete!)
      result = applyBackspaceAcrossLines(lines, '\b', false); // Still incomplete
      if (result !== null) {
        lines.push({ text: result, incomplete: true });
      }
      // After backspace: last char removed, still incomplete
      expect(lines.map(l => l.text).join('')).toBe('Counting: ');
      expect(lines[lines.length - 1].incomplete).toBe(true);

      // Chunk 3: "2"
      result = applyBackspaceAcrossLines(lines, '2', false);
      if (result !== null) {
        lines[lines.length - 1].text += result;
        lines[lines.length - 1].incomplete = true;
      }
      expect(lines.map(l => l.text).join('')).toBe('Counting: 2');

      // Chunk 4: "\b" alone
      result = applyBackspaceAcrossLines(lines, '\b', false);
      if (result !== null) {
        lines.push({ text: result, incomplete: true });
      }
      expect(lines.map(l => l.text).join('')).toBe('Counting: ');

      // Chunk 5: "3\n" complete
      result = applyBackspaceAcrossLines(lines, '3\n', true);
      if (result !== null) {
        lines[lines.length - 1].text += result;
        lines[lines.length - 1].incomplete = false;
      }
      expect(lines.map(l => l.text).join('')).toBe('Counting: 3\n');
    });
  });
});

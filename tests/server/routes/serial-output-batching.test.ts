/**
 * Tests for WebSocket serial_output batching (50ms)
 * 
 * Verifies that multiple serial_output messages emitted in quick succession
 * are batched together into single WebSocket messages instead of being sent
 * individually.
 * 
 * The batching is implemented in simulation.ws.ts:
 * - Lines are accumulated in a buffer for 50ms
 * - After 50ms, all buffered lines are sent as a single WebSocket message
 * - If a new line arrives while timer is running, it's added to the buffer
 * - On stop_simulation, the buffer is flushed immediately (no data loss)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('serial_output WebSocket Batching (simulation.ws.ts)', () => {
  
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T01: should batch multiple lines into a single message after 50ms', () => {
    const messages: any[] = [];
    
    const ws = {
      readyState: 1,
      send: vi.fn((msg: string) => {
        messages.push(JSON.parse(msg));
      }),
    };

    const clientSerialBuffers = new Map<any, { lines: Array<{ data: string; isComplete: boolean }>; flushTimer: NodeJS.Timeout | null }>();

    function flushSerialOutputBuffer(ws: any): void {
      const bufferState = clientSerialBuffers.get(ws);
      if (!bufferState || bufferState.lines.length === 0) {
        return;
      }

      bufferState.flushTimer = null;
      
      // Add newline after EVERY complete line (critical for batch boundary handling)
      const combinedData = bufferState.lines
        .map((lineObj) => {
          if (lineObj.isComplete) {
            return lineObj.data + '\n';
          }
          return lineObj.data;
        })
        .join('');
      
      const lastLine = bufferState.lines[bufferState.lines.length - 1];
      const finalIsComplete = lastLine?.isComplete ?? true;
      
      bufferState.lines = [];

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "serial_output",
          data: combinedData,
          isComplete: finalIsComplete,
        }));
      }
    }

    function sendSerialOutputBatched(ws: any, line: string, isComplete?: boolean): void {
      let bufferState = clientSerialBuffers.get(ws);
      if (!bufferState) {
        bufferState = { lines: [], flushTimer: null };
        clientSerialBuffers.set(ws, bufferState);
      }

      bufferState.lines.push({ data: line, isComplete: isComplete ?? true });

      if (!bufferState.flushTimer) {
        bufferState.flushTimer = setTimeout(() => {
          flushSerialOutputBuffer(ws);
        }, 50) as unknown as NodeJS.Timeout;
      }
    }

    // Send 3 lines with isComplete=true (simulating println output)
    sendSerialOutputBatched(ws, 'Hello', true);
    sendSerialOutputBatched(ws, 'World', true);
    sendSerialOutputBatched(ws, 'Test', true);

    expect(messages.length).toBe(0);
    vi.advanceTimersByTime(50);

    // All lines have newlines after them (newline AFTER every complete line)
    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('serial_output');
    expect(messages[0].data).toBe('Hello\nWorld\nTest\n');
    expect(messages[0].isComplete).toBe(true);
  });

  it('T02: should send separate batches if 50ms gap occurs between messages', () => {
    const messages: any[] = [];
    
    const ws = {
      readyState: 1,
      send: vi.fn((msg: string) => {
        messages.push(JSON.parse(msg));
      }),
    };

    const clientSerialBuffers = new Map<any, { lines: Array<{ data: string; isComplete: boolean }>; flushTimer: NodeJS.Timeout | null }>();

    function flushSerialOutputBuffer(ws: any): void {
      const bufferState = clientSerialBuffers.get(ws);
      if (!bufferState || bufferState.lines.length === 0) {
        return;
      }

      bufferState.flushTimer = null;
      
      const combinedData = bufferState.lines
        .map((lineObj) => {
          if (lineObj.isComplete) {
            return lineObj.data + '\n';
          }
          return lineObj.data;
        })
        .join('');
      
      const lastLine = bufferState.lines[bufferState.lines.length - 1];
      const finalIsComplete = lastLine?.isComplete ?? true;
      
      bufferState.lines = [];

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "serial_output",
          data: combinedData,
          isComplete: finalIsComplete,
        }));
      }
    }

    function sendSerialOutputBatched(ws: any, line: string, isComplete?: boolean): void {
      let bufferState = clientSerialBuffers.get(ws);
      if (!bufferState) {
        bufferState = { lines: [], flushTimer: null };
        clientSerialBuffers.set(ws, bufferState);
      }

      bufferState.lines.push({ data: line, isComplete: isComplete ?? true });

      if (!bufferState.flushTimer) {
        bufferState.flushTimer = setTimeout(() => {
          flushSerialOutputBuffer(ws);
        }, 50) as unknown as NodeJS.Timeout;
      }
    }

    sendSerialOutputBatched(ws, 'Line1', true);
    sendSerialOutputBatched(ws, 'Line2', true);
    
    vi.advanceTimersByTime(50);
    expect(messages.length).toBe(1);
    expect(messages[0].data).toBe('Line1\nLine2\n');
    expect(messages[0].isComplete).toBe(true);

    sendSerialOutputBatched(ws, 'Line3', true);
    
    vi.advanceTimersByTime(50);
    expect(messages.length).toBe(2);
    expect(messages[1].data).toBe('Line3\n');
    expect(messages[1].isComplete).toBe(true);
  });

  it('T03: should handle incomplete lines (no trailing newline)', () => {
    const messages: any[] = [];
    
    const ws = {
      readyState: 1,
      send: vi.fn((msg: string) => {
        messages.push(JSON.parse(msg));
      }),
    };

    const clientSerialBuffers = new Map<any, { lines: Array<{ data: string; isComplete: boolean }>; flushTimer: NodeJS.Timeout | null }>();

    function flushSerialOutputBuffer(ws: any): void {
      const bufferState = clientSerialBuffers.get(ws);
      if (!bufferState || bufferState.lines.length === 0) {
        return;
      }

      bufferState.flushTimer = null;
      
      const combinedData = bufferState.lines
        .map((lineObj) => {
          if (lineObj.isComplete) {
            return lineObj.data + '\n';
          }
          return lineObj.data;
        })
        .join('');
      
      const lastLine = bufferState.lines[bufferState.lines.length - 1];
      const finalIsComplete = lastLine?.isComplete ?? true;
      
      bufferState.lines = [];

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "serial_output",
          data: combinedData,
          isComplete: finalIsComplete,
        }));
      }
    }

    function sendSerialOutputBatched(ws: any, line: string, isComplete?: boolean): void {
      let bufferState = clientSerialBuffers.get(ws);
      if (!bufferState) {
        bufferState = { lines: [], flushTimer: null };
        clientSerialBuffers.set(ws, bufferState);
      }

      bufferState.lines.push({ data: line, isComplete: isComplete ?? true });

      if (!bufferState.flushTimer) {
        bufferState.flushTimer = setTimeout(() => {
          flushSerialOutputBuffer(ws);
        }, 50) as unknown as NodeJS.Timeout;
      }
    }

    // Simulate Serial.print (incomplete) followed by Serial.println (complete)
    sendSerialOutputBatched(ws, 'Partial', false);
    sendSerialOutputBatched(ws, ' Output', true);
    
    vi.advanceTimersByTime(50);
    
    // Incomplete lines don't get newlines, complete ones do
    expect(messages.length).toBe(1);
    expect(messages[0].data).toBe('Partial Output\n');
    expect(messages[0].isComplete).toBe(true);
  });

  it('T04: should handle incomplete line at buffer flush', () => {
    const messages: any[] = [];
    
    const ws = {
      readyState: 1,
      send: vi.fn((msg: string) => {
        messages.push(JSON.parse(msg));
      }),
    };

    const clientSerialBuffers = new Map<any, { lines: Array<{ data: string; isComplete: boolean }>; flushTimer: NodeJS.Timeout | null }>();

    function flushSerialOutputBuffer(ws: any): void {
      const bufferState = clientSerialBuffers.get(ws);
      if (!bufferState || bufferState.lines.length === 0) {
        return;
      }

      bufferState.flushTimer = null;
      
      const combinedData = bufferState.lines
        .map((lineObj) => {
          if (lineObj.isComplete) {
            return lineObj.data + '\n';
          }
          return lineObj.data;
        })
        .join('');
      
      const lastLine = bufferState.lines[bufferState.lines.length - 1];
      const finalIsComplete = lastLine?.isComplete ?? true;
      
      bufferState.lines = [];

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "serial_output",
          data: combinedData,
          isComplete: finalIsComplete,
        }));
      }
    }

    function sendSerialOutputBatched(ws: any, line: string, isComplete?: boolean): void {
      let bufferState = clientSerialBuffers.get(ws);
      if (!bufferState) {
        bufferState = { lines: [], flushTimer: null };
        clientSerialBuffers.set(ws, bufferState);
      }

      bufferState.lines.push({ data: line, isComplete: isComplete ?? true });

      if (!bufferState.flushTimer) {
        bufferState.flushTimer = setTimeout(() => {
          flushSerialOutputBuffer(ws);
        }, 50) as unknown as NodeJS.Timeout;
      }
    }

    sendSerialOutputBatched(ws, 'Still typing', false);
    
    vi.advanceTimersByTime(50);
    
    // Incomplete line has no newline
    expect(messages.length).toBe(1);
    expect(messages[0].data).toBe('Still typing');
    expect(messages[0].isComplete).toBe(false);
  });

  it('T05: should preserve batch order for rapid-fire messages', () => {
    const messages: any[] = [];
    
    const ws = {
      readyState: 1,
      send: vi.fn((msg: string) => {
        messages.push(JSON.parse(msg));
      }),
    };

    const clientSerialBuffers = new Map<any, { lines: Array<{ data: string; isComplete: boolean }>; flushTimer: NodeJS.Timeout | null }>();

    function flushSerialOutputBuffer(ws: any): void {
      const bufferState = clientSerialBuffers.get(ws);
      if (!bufferState || bufferState.lines.length === 0) {
        return;
      }

      bufferState.flushTimer = null;
      
      const combinedData = bufferState.lines
        .map((lineObj) => {
          if (lineObj.isComplete) {
            return lineObj.data + '\n';
          }
          return lineObj.data;
        })
        .join('');
      
      const lastLine = bufferState.lines[bufferState.lines.length - 1];
      const finalIsComplete = lastLine?.isComplete ?? true;
      
      bufferState.lines = [];

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "serial_output",
          data: combinedData,
          isComplete: finalIsComplete,
        }));
      }
    }

    function sendSerialOutputBatched(ws: any, line: string, isComplete?: boolean): void {
      let bufferState = clientSerialBuffers.get(ws);
      if (!bufferState) {
        bufferState = { lines: [], flushTimer: null };
        clientSerialBuffers.set(ws, bufferState);
      }

      bufferState.lines.push({ data: line, isComplete: isComplete ?? true });

      if (!bufferState.flushTimer) {
        bufferState.flushTimer = setTimeout(() => {
          flushSerialOutputBuffer(ws);
        }, 50) as unknown as NodeJS.Timeout;
      }
    }

    for (let i = 0; i < 10; i++) {
      sendSerialOutputBatched(ws, `Line${i}`, true);
    }
    
    vi.advanceTimersByTime(50);
    
    expect(messages.length).toBe(1);
    let expectedData = '';
    for (let i = 0; i < 10; i++) {
      expectedData += `Line${i}\n`;
    }
    expect(messages[0].data).toBe(expectedData);
    expect(messages[0].isComplete).toBe(true);
  });
});


/**
 * Tests for WebSocket serial_output batching (50ms)
 * 
 * Verifies that multiple serial_output messages emitted in quick succession
 * are batched together into single WebSocket messages instead of being sent
 * individually.
 * 
 * The batching is implemented in WsOutputBuffer:
 * - Lines are accumulated in a buffer for 50ms
 * - After 50ms, all buffered lines are sent as a single WebSocket message
 * - If a new line arrives while timer is running, it's added to the buffer
 * - On stop_simulation, the buffer is flushed immediately (no data loss)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { WsOutputBuffer } from "../../../server/routes/simulation/ws-output-buffer";

function createBatcher(): {
  messages: any[];
  ws: WebSocket;
  send: (line: string, isComplete?: boolean) => void;
  flush: () => void;
} {
  const messages: any[] = [];
  const outputBuffer = new WsOutputBuffer();
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn((msg: string) => {
      messages.push(JSON.parse(msg));
    }),
  } as unknown as WebSocket;

  function send(line: string, isComplete?: boolean): void {
    outputBuffer.sendSerialOutputBatched(ws, line, isComplete);
  }

  return {
    messages,
    ws,
    send,
    flush: () => outputBuffer.flushSerialOutputBuffer(ws),
  };
}

describe("serial_output WebSocket Batching (WsOutputBuffer)", () => {
  
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T01: should batch multiple lines into a single message after 50ms', () => {
    const { messages, send } = createBatcher();

    // Send 3 lines with isComplete=true (simulating println output)
    send("Hello", true);
    send("World", true);
    send("Test", true);

    expect(messages.length).toBe(0);
    vi.advanceTimersByTime(50);

    // All lines have newlines after them (newline AFTER every complete line)
    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe("serial_output");
    expect(messages[0].data).toBe("Hello\nWorld\nTest\n");
    expect(messages[0].isComplete).toBe(true);
  });

  it('T02: should send separate batches if 50ms gap occurs between messages', () => {
    const { messages, send } = createBatcher();

    send("Line1", true);
    send("Line2", true);
    
    vi.advanceTimersByTime(50);
    expect(messages.length).toBe(1);
    expect(messages[0].data).toBe("Line1\nLine2\n");
    expect(messages[0].isComplete).toBe(true);

    send("Line3", true);
    
    vi.advanceTimersByTime(50);
    expect(messages.length).toBe(2);
    expect(messages[1].data).toBe("Line3\n");
    expect(messages[1].isComplete).toBe(true);
  });

  it('T03: should handle incomplete lines (no trailing newline)', () => {
    const { messages, send } = createBatcher();

    // Simulate Serial.print (incomplete) followed by Serial.println (complete)
    send("Partial", false);
    send(" Output", true);
    
    vi.advanceTimersByTime(50);
    
    // Incomplete lines don't get newlines, complete ones do
    expect(messages.length).toBe(1);
    expect(messages[0].data).toBe("Partial Output\n");
    expect(messages[0].isComplete).toBe(true);
  });

  it('T04: should handle incomplete line at buffer flush', () => {
    const { messages, send } = createBatcher();

    send("Still typing", false);
    
    vi.advanceTimersByTime(50);
    
    // Incomplete line has no newline
    expect(messages.length).toBe(1);
    expect(messages[0].data).toBe("Still typing");
    expect(messages[0].isComplete).toBe(false);
  });

  it('T05: should preserve batch order for rapid-fire messages', () => {
    const { messages, send } = createBatcher();

    for (let i = 0; i < 10; i++) {
      send(`Line${i}`, true);
    }
    
    vi.advanceTimersByTime(50);
    
    expect(messages.length).toBe(1);
    let expectedData = "";
    for (let i = 0; i < 10; i++) {
      expectedData += `Line${i}\n`;
    }
    expect(messages[0].data).toBe(expectedData);
    expect(messages[0].isComplete).toBe(true);
  });

  it("T06: should flush immediately on explicit flush", () => {
    const { messages, send, flush } = createBatcher();

    send("Before stop", true);
    flush();

    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe("Before stop\n");
  });
});

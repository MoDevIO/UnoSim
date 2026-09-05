import { WebSocket } from "ws";
import { WSMessageType, type ServerToClientWSMessage } from "@shared/schema";

type SerialBufferState = {
  lines: Array<{ data: string; isComplete: boolean }>;
  flushTimer: NodeJS.Timeout | null;
};

export function sendMessageToClient(
  ws: WebSocket,
  message: ServerToClientWSMessage,
): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export class WsOutputBuffer {
  private readonly clientSerialBuffers = new Map<WebSocket, SerialBufferState>();

  sendSerialOutputBatched(
    ws: WebSocket,
    line: string,
    isComplete?: boolean,
  ): void {
    let bufferState = this.clientSerialBuffers.get(ws);
    bufferState ??= { lines: [], flushTimer: null };
    this.clientSerialBuffers.set(ws, bufferState);

    bufferState.lines.push({ data: line, isComplete: isComplete ?? true });
    bufferState.flushTimer ??= setTimeout(() => {
      this.flushSerialOutputBuffer(ws);
    }, 50);
  }

  flushSerialOutputBuffer(ws: WebSocket): void {
    const bufferState = this.clientSerialBuffers.get(ws);
    if (!bufferState || bufferState.lines.length === 0) {
      return;
    }

    bufferState.flushTimer = null;
    const combinedData = bufferState.lines
      .map((lineObj) => (lineObj.isComplete ? `${lineObj.data}\n` : lineObj.data))
      .join("");
    const lastLine = bufferState.lines.at(-1);
    const finalIsComplete = lastLine?.isComplete ?? true;
    bufferState.lines = [];

    sendMessageToClient(ws, {
      type: WSMessageType.SERIAL_OUTPUT,
      data: combinedData,
      isComplete: finalIsComplete,
    });
  }

  clearClient(ws: WebSocket): void {
    const bufferState = this.clientSerialBuffers.get(ws);
    if (bufferState?.flushTimer) {
      clearTimeout(bufferState.flushTimer);
    }
    this.clientSerialBuffers.delete(ws);
  }
}

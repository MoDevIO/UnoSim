import { act, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WSMessage } from "@shared/schema";
import { useWebSocket } from "@/hooks/use-websocket";

const listeners = new Map<string, Set<(payload: unknown) => void>>();
const manager = {
  on: vi.fn((event: string, callback: (payload: unknown) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(callback);
    return () => listeners.get(event)?.delete(callback);
  }),
  connect: vi.fn(),
  isConnected: () => true,
  getState: () => "connected",
  hasEverConnected: () => true,
  send: vi.fn(() => true),
  sendImmediate: vi.fn(() => true),
};

vi.mock("@/lib/websocket-manager", () => ({ getWebSocketManager: () => manager }));

const serial = (data: string): WSMessage => ({ type: "serial_output", data } as WSMessage);
const emit = (message: WSMessage) => listeners.get("message")?.forEach((listener) => listener(message));

describe("useWebSocket message queue", () => {
  beforeEach(() => {
    listeners.clear();
    manager.on.mockClear();
  });

  it("hands every message to the consumer exactly once, also when more arrive while it consumes", () => {
    const processed: string[] = [];
    let renders = 0;
    renderHook(() => {
      renders += 1;
      const { messageQueue, consumeMessages } = useWebSocket();
      useEffect(() => {
        if (messageQueue.length === 0) return;
        for (const message of consumeMessages()) {
          processed.push((message as { data: string }).data);
          // A message that arrives during processing joins the queue for the next pass.
          if ((message as { data: string }).data === "b") emit(serial("c"));
        }
      }, [messageQueue, consumeMessages]);
    });

    act(() => {
      emit(serial("a"));
      emit(serial("b"));
    });
    const rendersAfterBurst = renders;
    act(() => emit(serial("d")));

    expect(processed).toEqual(["a", "b", "c", "d"]);
    // Consuming sets no state: one render per arrival, none for taking the messages out.
    expect(renders - rendersAfterBurst).toBe(1);
  });

  it("does not subscribe to messages when the caller only needs the connection state", () => {
    const { result } = renderHook(() => useWebSocket({ receiveMessages: false }));
    act(() => emit(serial("ignored")));
    expect(manager.on).not.toHaveBeenCalledWith("message", expect.any(Function));
    expect(result.current.messageQueue).toEqual([]);
  });
});

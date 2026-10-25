import { describe, expect, it } from "vitest";
import { clientToServerWSMessageSchema, serverToClientWSMessageSchema, WSMessageType } from "../../shared/schema";
import { INPUT_LIMITS } from "../../shared/input-limits";
import { decodeClientMessage } from "../../server/services/ws-message-decoder";

/**
 * The direction of a WebSocket message is decided by its type before any content is validated. Parsing the
 * whole union and checking the direction afterwards let a client send server events with large arrays: a
 * message below the payload limit gave 240 000 issues and about 100 MiB of heap before it was refused.
 */
const repeat = (element: unknown, count: number) => Array.from({ length: count }, () => element);
const issueCount = (schema: { safeParse(value: unknown): { success: boolean; error?: { issues: unknown[] } } }, value: unknown) => {
  const started = performance.now();
  const result = schema.safeParse(value);
  return { success: result.success, issues: result.error?.issues.length ?? 0, ms: performance.now() - started };
};

describe("WebSocket direction before content", () => {
  it("refuses server events with large arrays from a client with one issue and without validating the content", () => {
    const events = [
      { type: "pin_state_batch", timestamp: 1, states: repeat({}, 80_000) },
      { type: "io_registry", registry: repeat({ usedAt: repeat({}, 100) }, 2_000) },
      { type: "io_registry", registry: repeat({}, 60_000) },
    ];

    for (const event of events) {
      const result = issueCount(clientToServerWSMessageSchema, event);
      expect(result.success).toBe(false);
      expect(result.issues).toBe(1);
      expect(result.ms).toBeLessThan(50);
    }
  });

  it("refuses every message type of the other direction by its type alone", () => {
    const junk = repeat({}, 50_000);
    for (const type of Object.values(WSMessageType)) {
      const message = { type, states: junk, registry: junk, headers: junk };
      const toServer = issueCount(clientToServerWSMessageSchema, message);
      const toClient = issueCount(serverToClientWSMessageSchema, message);

      // Whatever the type is, one direction refuses it at once; the other one may validate it.
      expect(Math.min(toServer.issues + (toServer.success ? Infinity : 0), toClient.issues + (toClient.success ? Infinity : 0))).toBeLessThanOrEqual(1);
      expect(Math.min(toServer.ms, toClient.ms)).toBeLessThan(50);
    }
  });

  it("answers a message of 256 KiB from a client that carries a server event with null, as for every invalid message", () => {
    const text = JSON.stringify({ type: "pin_state_batch", timestamp: 1, states: repeat({}, (INPUT_LIMITS.webSocket.maxPayloadBytes / 3) | 0) });
    const started = performance.now();

    expect(decodeClientMessage(text)).toBeNull();
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("still accepts the client messages and the server messages of the contract", () => {
    expect(clientToServerWSMessageSchema.safeParse({ type: "pause_simulation" }).success).toBe(true);
    expect(clientToServerWSMessageSchema.safeParse({ type: "set_pin_value", pin: 2, value: 1 }).success).toBe(true);
    expect(clientToServerWSMessageSchema.safeParse({ type: "start_simulation", code: "x", headers: [{ name: "a.h", content: "" }] }).success).toBe(true);
    expect(serverToClientWSMessageSchema.safeParse({ type: "simulation_status", status: "running" }).success).toBe(true);
    expect(serverToClientWSMessageSchema.safeParse({ type: "pin_state_batch", timestamp: 1, states: [{ pin: 1, stateType: "value", value: 1 }] }).success).toBe(true);
  });

  it("keeps refusing a client message of a server type and a server message of a client type", () => {
    expect(clientToServerWSMessageSchema.safeParse({ type: "simulation_status", status: "running" }).success).toBe(false);
    expect(serverToClientWSMessageSchema.safeParse({ type: "pause_simulation" }).success).toBe(false);
  });

  it("keeps the header collision check of start_simulation", () => {
    const message = { type: "start_simulation", code: "x", entryFile: "main.ino", headers: [{ name: "main.ino", content: "" }] };

    expect(clientToServerWSMessageSchema.safeParse(message).success).toBe(false);
  });
});

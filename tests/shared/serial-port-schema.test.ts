import { describe, expect, it } from "vitest";
import { clientToServerWSMessageSchema, serverToClientWSMessageSchema } from "@shared/schema";

describe("serial port in the WebSocket messages (plan P5.3)", () => {
  it.each([0, 1, 2, 3])("accepts serial_input and serial_output for port %i", (port) => {
    expect(clientToServerWSMessageSchema.safeParse({ type: "serial_input", data: "x", port }).success).toBe(true);
    expect(serverToClientWSMessageSchema.safeParse({ type: "serial_output", data: "x", port }).success).toBe(true);
  });

  it.each([-1, 4, 1.5, "1"])("rejects port %j", (port) => {
    expect(clientToServerWSMessageSchema.safeParse({ type: "serial_input", data: "x", port }).success).toBe(false);
    expect(serverToClientWSMessageSchema.safeParse({ type: "serial_output", data: "x", port }).success).toBe(false);
  });

  it("keeps the messages without a port valid", () => {
    expect(clientToServerWSMessageSchema.safeParse({ type: "serial_input", data: "x" }).success).toBe(true);
    expect(serverToClientWSMessageSchema.safeParse({ type: "serial_output", data: "x", isComplete: true }).success).toBe(true);
  });
});

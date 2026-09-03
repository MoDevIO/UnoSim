import { describe, expect, it } from "vitest";
import {
  clientToServerWSMessageSchema,
  serverToClientWSMessageSchema,
} from "../../shared/schema";

describe("WebSocket direction schemas", () => {
  it("accepts only browser commands on the client-to-server boundary", () => {
    expect(
      clientToServerWSMessageSchema.safeParse({
        type: "set_pin_value",
        pin: 13,
        value: 1,
      }).success,
    ).toBe(true);
    expect(
      clientToServerWSMessageSchema.safeParse({
        type: "pin_state",
        pin: 13,
        stateType: "value",
        value: 1,
      }).success,
    ).toBe(false);
    expect(
      clientToServerWSMessageSchema.safeParse({
        type: "serial_input",
        data: "hello",
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      clientToServerWSMessageSchema.safeParse({
        type: "set_pin_value",
        pin: "13",
        value: 1,
      }).success,
    ).toBe(false);
  });

  it("accepts only server events on the server-to-client boundary", () => {
    expect(
      serverToClientWSMessageSchema.safeParse({
        type: "simulation_status",
        status: "running",
      }).success,
    ).toBe(true);
    expect(
      serverToClientWSMessageSchema.safeParse({
        type: "start_simulation",
      }).success,
    ).toBe(false);
  });
});

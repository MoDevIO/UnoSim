import { describe, expect, it } from "vitest";
import { OutputCollector } from "../../../server/services/output-collector";
import { WsSessionLifecycle } from "../../../server/services/ws-session-lifecycle";

describe("extracted lifecycle and output ports", () => {
  it("manages websocket sessions without exposing the backing map", () => {
    const sessions = new WsSessionLifecycle<string, number>();
    sessions.register("a", 1);
    expect(sessions.get("a")).toBe(1);
    expect(sessions.remove("a")).toBe(1);
    expect(sessions.size).toBe(0);
  });
  it("enforces output limits at the collection boundary", () => {
    const output = new OutputCollector(3);
    expect(output.append("ab")).toBe(true);
    expect(output.append("cd")).toBe(false);
    expect(output.totalBytes).toBe(4);
  });
});

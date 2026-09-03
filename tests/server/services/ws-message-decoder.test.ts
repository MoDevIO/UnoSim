import { describe, expect, it } from "vitest";
import { decodeClientMessage } from "../../../server/services/ws-message-decoder";

describe("WebSocket message decoder", () => {
  it("decodes valid client messages and rejects malformed input", () => {
    expect(decodeClientMessage(JSON.stringify({ type: "stop_simulation" }))).toEqual({ type: "stop_simulation" });
    expect(decodeClientMessage("not json")).toBeNull();
    expect(decodeClientMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
  });
});

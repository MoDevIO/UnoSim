import { describe, it, expect } from "vitest";
import { wsMessageSchema } from "../../shared/schema";

describe("wsMessageSchema sim_telemetry", () => {
  it("preserves serial byte metrics fields", () => {
    const message = {
      type: "sim_telemetry",
      metrics: {
        timestamp: Date.now(),
        intendedPinChangesPerSecond: 1,
        actualPinChangesPerSecond: 1,
        droppedPinChangesPerSecond: 0,
        batchesPerSecond: 1,
        avgStatesPerBatch: 1,
        serialOutputPerSecond: 5,
        serialBytesPerSecond: 120,
        serialBytesTotal: 1200,
      },
    };

    const parsed = wsMessageSchema.safeParse(message);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metrics).toHaveProperty("serialBytesPerSecond", 120);
      expect(parsed.data.metrics).toHaveProperty("serialBytesTotal", 1200);
    }
  });
});

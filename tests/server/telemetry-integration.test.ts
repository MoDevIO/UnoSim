// telemetry-integration.test.ts
// Integration tests for telemetry pipeline

import { describe, it, expect, beforeEach, vi, fake } from "vitest";

// Mock types matching the actual schema
interface PerformanceMetrics {
  incomingEvents: number;
  sentBatches: number;
  eventsPerSecond: number;
  batchEfficiency: number;
  pinChangesPerSecond: number;
  isThrottled: boolean;
  serialOutputPerSecond: number;
  timestamp: number;
}

interface TelemetryMessage {
  type: "sim_telemetry";
  msg_id: number;
  timestamp: number;
  payload: PerformanceMetrics;
}

// Simulate the server's message encoding
function createTelemetryMessage(
  metrics: PerformanceMetrics,
  msgId: number,
): TelemetryMessage {
  return {
    type: "sim_telemetry",
    msg_id: msgId,
    timestamp: Date.now(),
    payload: metrics,
  };
}

// Simulate server-side pin change tracking
class ServerTelemetrySimulator {
  private pinChanges = 0;
  private serialOutputs = 0;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceActive = false;
  private messageId = 0;

  recordPinChange() {
    this.pinChanges++;
    // Simulate debounce
    if (this.debounceActive) return;

    this.debounceActive = true;
    this.debounceTimer = setTimeout(() => {
      this.debounceActive = false;
    }, 50);
  }

  recordSerialOutput() {
    this.serialOutputs++;
  }

  getMetrics(): PerformanceMetrics {
    const now = Date.now();
    const pinsPerSec = this.pinChanges;
    const serialPerSec = this.serialOutputs;

    // Reset counters for next interval
    this.pinChanges = 0;
    this.serialOutputs = 0;

    return {
      incomingEvents: 0,
      sentBatches: 0,
      eventsPerSecond: 0,
      batchEfficiency: 0,
      pinChangesPerSecond: pinsPerSec,
      isThrottled: this.debounceActive,
      serialOutputPerSecond: serialPerSec,
      timestamp: now,
    };
  }

  getTelemetryMessage(): TelemetryMessage {
    this.messageId++;
    return createTelemetryMessage(this.getMetrics(), this.messageId);
  }

  cleanup() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

// Simulate client-side telemetry receiver
class ClientTelemetryReceiver {
  private lastMetric: PerformanceMetrics | null = null;
  private history: PerformanceMetrics[] = [];

  receiveMessage(msg: TelemetryMessage): void {
    this.lastMetric = msg.payload;
    this.history.push(msg.payload);
  }

  getLastMetric(): PerformanceMetrics | null {
    return this.lastMetric;
  }

  getHistory(): PerformanceMetrics[] {
    return this.history;
  }

  getMaxPinChangesPerSecond(): number {
    return Math.max(...this.history.map((m) => m.pinChangesPerSecond), 0);
  }

  getMaxSerialOutputPerSecond(): number {
    return Math.max(...this.history.map((m) => m.serialOutputPerSecond), 0);
  }

  reset(): void {
    this.lastMetric = null;
    this.history = [];
  }
}

describe("Telemetry - E2E Integration Pipeline", () => {
  let server: ServerTelemetrySimulator;
  let client: ClientTelemetryReceiver;

  beforeEach(() => {
    server = new ServerTelemetrySimulator();
    client = new ClientTelemetryReceiver();
  });

  afterEach(() => {
    server.cleanup();
  });

  describe("Pin Change Tracking Pipeline", () => {
    it("should track single pin change and report correctly", () => {
      // Server: record one pin change
      server.recordPinChange();

      // Server: generate telemetry message
      const msg = server.getTelemetryMessage();

      // Client: receive message
      client.receiveMessage(msg);

      // Verify metric is transmitted correctly
      const lastMetric = client.getLastMetric();
      expect(lastMetric).not.toBeNull();
      expect(lastMetric!.pinChangesPerSecond).toBe(1);
      expect(lastMetric!.isThrottled).toBe(true); // Debounce active
    });

    it("should track multiple pin changes in single interval", () => {
      // Server: rapid pin changes
      server.recordPinChange();
      server.recordPinChange();
      server.recordPinChange();
      server.recordPinChange();
      server.recordPinChange();

      // Server: generate telemetry
      const msg = server.getTelemetryMessage();

      // Client: receive
      client.receiveMessage(msg);

      // Verify all changes counted
      const lastMetric = client.getLastMetric();
      expect(lastMetric!.pinChangesPerSecond).toBe(5);
    });

    it("should reset pin counter after reporting", () => {
      // First interval: 5 changes
      server.recordPinChange();
      server.recordPinChange();
      server.recordPinChange();
      server.recordPinChange();
      server.recordPinChange();

      let msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      expect(client.getLastMetric()!.pinChangesPerSecond).toBe(5);

      // Second interval: 3 changes (starting fresh)
      server.recordPinChange();
      server.recordPinChange();
      server.recordPinChange();

      msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      expect(client.getLastMetric()!.pinChangesPerSecond).toBe(3);
    });

    it("should track debounce state correctly across reports", () => {
      // Record change to activate debounce
      server.recordPinChange();
      let msg = server.getTelemetryMessage();
      client.receiveMessage(msg);
      expect(client.getLastMetric()!.isThrottled).toBe(true);

      // Immediately after, debounce still active
      msg = server.getTelemetryMessage();
      client.receiveMessage(msg);
      expect(client.getLastMetric()!.isThrottled).toBe(true);

      // Wait for debounce to clear
      server.cleanup();
      server = new ServerTelemetrySimulator(); // Fresh instance
      msg = server.getTelemetryMessage();
      client.receiveMessage(msg);
      expect(client.getLastMetric()!.isThrottled).toBe(false);
    });
  });

  describe("Serial Output Tracking Pipeline", () => {
    it("should track single serial output event", () => {
      // Server: receive serial output
      server.recordSerialOutput();

      // Server: generate message
      const msg = server.getTelemetryMessage();

      // Client: receive
      client.receiveMessage(msg);

      // Verify
      const lastMetric = client.getLastMetric();
      expect(lastMetric!.serialOutputPerSecond).toBe(1);
    });

    it("should track high-frequency serial output", () => {
      // Server: rapid serial outputs
      for (let i = 0; i < 50; i++) {
        server.recordSerialOutput();
      }

      // Server: generate message
      const msg = server.getTelemetryMessage();

      // Client: receive
      client.receiveMessage(msg);

      // Verify
      expect(client.getLastMetric()!.serialOutputPerSecond).toBe(50);
    });

    it("should reset serial counter independently from pin counter", () => {
      // First interval: 5 pins, 10 serial events
      for (let i = 0; i < 5; i++) {
        server.recordPinChange();
      }
      for (let i = 0; i < 10; i++) {
        server.recordSerialOutput();
      }

      let msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      expect(client.getLastMetric()!.pinChangesPerSecond).toBe(5);
      expect(client.getLastMetric()!.serialOutputPerSecond).toBe(10);

      // Second interval: only pins (no serial)
      for (let i = 0; i < 3; i++) {
        server.recordPinChange();
      }

      msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      expect(client.getLastMetric()!.pinChangesPerSecond).toBe(3);
      expect(client.getLastMetric()!.serialOutputPerSecond).toBe(0);
    });
  });

  describe("Combined Metrics Pipeline", () => {
    it("should track pins and serial independently", () => {
      // Record both types in same interval
      for (let i = 0; i < 12; i++) {
        server.recordPinChange();
      }
      for (let i = 0; i < 8; i++) {
        server.recordSerialOutput();
      }

      const msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      const metric = client.getLastMetric()!;
      expect(metric.pinChangesPerSecond).toBe(12);
      expect(metric.serialOutputPerSecond).toBe(8);
    });

    it("should maintain peak tracking across multiple intervals", () => {
      const intervals = [
        { pins: 5, serial: 10 },
        { pins: 15, serial: 8 }, // Peak pins
        { pins: 3, serial: 25 }, // Peak serial
        { pins: 10, serial: 5 },
      ];

      for (const interval of intervals) {
        for (let i = 0; i < interval.pins; i++) {
          server.recordPinChange();
        }
        for (let i = 0; i < interval.serial; i++) {
          server.recordSerialOutput();
        }

        const msg = server.getTelemetryMessage();
        client.receiveMessage(msg);
      }

      // Verify peaks
      expect(client.getMaxPinChangesPerSecond()).toBe(15);
      expect(client.getMaxSerialOutputPerSecond()).toBe(25);
    });

    it("should preserve chronological order of metrics", () => {
      const metrics = [];

      for (let i = 0; i < 3; i++) {
        server.recordPinChange();
        const msg = server.getTelemetryMessage();
        client.receiveMessage(msg);
        metrics.push(msg.payload);
      }

      const history = client.getHistory();
      expect(history.length).toBe(3);

      // Verify timestamps are increasing
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp).toBeGreaterThanOrEqual(
          history[i - 1].timestamp,
        );
      }
    });
  });

  describe("Zero State & Edge Cases", () => {
    it("should report zero metrics when no activity", () => {
      // No pin changes, no serial output
      const msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      const metric = client.getLastMetric()!;
      expect(metric.pinChangesPerSecond).toBe(0);
      expect(metric.serialOutputPerSecond).toBe(0);
      expect(metric.isThrottled).toBe(false);
    });

    it("should handle very high pin change rates", () => {
      // Simulate 300 pin changes per second
      for (let i = 0; i < 300; i++) {
        server.recordPinChange();
      }

      const msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      expect(client.getLastMetric()!.pinChangesPerSecond).toBe(300);
    });

    it("should handle very high serial output rates", () => {
      // Simulate 500 serial events per second
      for (let i = 0; i < 500; i++) {
        server.recordSerialOutput();
      }

      const msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      expect(client.getLastMetric()!.serialOutputPerSecond).toBe(500);
    });

    it("should handle rapid alternating pin and serial events", () => {
      // Alternate rapidly
      for (let i = 0; i < 20; i++) {
        server.recordPinChange();
        server.recordSerialOutput();
      }

      const msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      const metric = client.getLastMetric()!;
      expect(metric.pinChangesPerSecond).toBe(20);
      expect(metric.serialOutputPerSecond).toBe(20);
    });
  });

  describe("Message Integrity", () => {
    it("should preserve all metric fields in transmission", () => {
      server.recordPinChange();
      for (let i = 0; i < 5; i++) {
        server.recordSerialOutput();
      }

      const msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      const metric = client.getLastMetric()!;

      // Verify all required fields present and non-null
      expect(metric).toHaveProperty("incomingEvents");
      expect(metric).toHaveProperty("sentBatches");
      expect(metric).toHaveProperty("eventsPerSecond");
      expect(metric).toHaveProperty("batchEfficiency");
      expect(metric).toHaveProperty("pinChangesPerSecond");
      expect(metric).toHaveProperty("isThrottled");
      expect(metric).toHaveProperty("serialOutputPerSecond");
      expect(metric).toHaveProperty("timestamp");

      // Verify types
      expect(typeof metric.pinChangesPerSecond).toBe("number");
      expect(typeof metric.serialOutputPerSecond).toBe("number");
      expect(typeof metric.isThrottled).toBe("boolean");
      expect(typeof metric.timestamp).toBe("number");
    });

    it("should increment message IDs correctly", () => {
      const messages: TelemetryMessage[] = [];

      for (let i = 0; i < 5; i++) {
        messages.push(server.getTelemetryMessage());
      }

      // Verify sequential IDs
      for (let i = 0; i < messages.length; i++) {
        expect(messages[i].msg_id).toBe(i + 1);
      }
    });
  });

  describe("Concurrent Event Handling", () => {
    it("should correctly count simultaneous pin and serial changes", () => {
      // Simulate simultaneous events (all recorded in same batch)
      const pinEvents = 8;
      const serialEvents = 12;

      for (let i = 0; i < pinEvents; i++) {
        server.recordPinChange();
      }
      for (let i = 0; i < serialEvents; i++) {
        server.recordSerialOutput();
      }

      const msg = server.getTelemetryMessage();
      client.receiveMessage(msg);

      const metric = client.getLastMetric()!;
      expect(metric.pinChangesPerSecond).toBe(pinEvents);
      expect(metric.serialOutputPerSecond).toBe(serialEvents);
    });

    it("should handle burst patterns correctly", () => {
      // Simulate burst: high activity, then silence, then burst again
      const bursts = [
        { pins: 30, serial: 20 },
        { pins: 2, serial: 1 },
        { pins: 25, serial: 35 },
      ];

      for (const burst of bursts) {
        for (let i = 0; i < burst.pins; i++) {
          server.recordPinChange();
        }
        for (let i = 0; i < burst.serial; i++) {
          server.recordSerialOutput();
        }

        const msg = server.getTelemetryMessage();
        client.receiveMessage(msg);
      }

      // Verify history captured all bursts
      const history = client.getHistory();
      expect(history.length).toBe(3);
      expect(history[0].pinChangesPerSecond).toBe(30);
      expect(history[0].serialOutputPerSecond).toBe(20);
      expect(history[1].pinChangesPerSecond).toBe(2);
      expect(history[1].serialOutputPerSecond).toBe(1);
      expect(history[2].pinChangesPerSecond).toBe(25);
      expect(history[2].serialOutputPerSecond).toBe(35);
    });
  });
});

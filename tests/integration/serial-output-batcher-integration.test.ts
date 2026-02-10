// Integration test for SerialOutputBatcher in SandboxRunner
// Verifies: batcher creation, lifecycle integration, telemetry flow

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import type { IOPinRecord } from "@shared/schema";
import type { PerformanceMetrics } from "../../server/services/registry-manager";

describe("SerialOutputBatcher Integration", () => {
  let runner: SandboxRunner;
  let outputChunks: string[] = [];
  let telemetryData: PerformanceMetrics[] = [];

  beforeEach(() => {
    runner = new SandboxRunner();
    outputChunks = [];
    telemetryData = [];
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await runner.stop();
    vi.useRealTimers();
  });

  it("T-INT-01: Tight-loop Serial.println() triggers baudrate limiting", async () => {
    const floodingSketch = `
      void setup() {
        Serial.begin(115200);
      }
      
      void loop() {
        Serial.println("FLOOD");  // Tight loop - will exceed baudrate
      }
    `;

    const promise = runner.runSketch({
      code: floodingSketch,
      onOutput: (data) => {
        outputChunks.push(data);
      },
      onTelemetry: (metrics) => {
        telemetryData.push(metrics);
      },
      onIORegistry: () => {},
      onError: () => {},
      onPinState: () => {},
      timeoutSec: 2,
    });

    // Wait for simulation to start and produce output
    await vi.advanceTimersByTimeAsync(1500);

    // Check if any output contains drop indicator
    const hasDropIndicator = outputChunks.some((chunk) =>
      chunk.includes("[⚠")
    );

    // With a tight loop, we expect drops at 115200 baud
    expect(hasDropIndicator).toBe(true);

    await runner.stop();
    await promise;
  });

  it("T-INT-02: Normal sketch (100ms delay) produces no drops at 115200 baud", async () => {
    const normalSketch = `
      void setup() {
        Serial.begin(115200);
      }
      
      void loop() {
        Serial.println("Normal output");
        delay(100);
      }
    `;

    const promise = runner.runSketch({
      code: normalSketch,
      onOutput: (data) => {
        outputChunks.push(data);
      },
      onTelemetry: (metrics) => {
        telemetryData.push(metrics);
      },
      onIORegistry: () => {},
      onError: () => {},
      onPinState: () => {},
      timeoutSec: 2,
    });

    // Wait for simulation to produce output
    await vi.advanceTimersByTimeAsync(1500);

    // Check that NO drop indicator appears
    const hasDropIndicator = outputChunks.some((chunk) =>
      chunk.includes("[⚠")
    );

    expect(hasDropIndicator).toBe(false);

    await runner.stop();
    await promise;
  });

  it("T-INT-03: Telemetry reports serialDroppedBytesPerSecond > 0 during flooding", async () => {
    const floodingSketch = `
      void setup() {
        Serial.begin(115200);
      }
      
      void loop() {
        Serial.println("FLOOD FLOOD FLOOD FLOOD FLOOD");
      }
    `;

    const promise = runner.runSketch({
      code: floodingSketch,
      onOutput: () => {},
      onTelemetry: (metrics) => {
        telemetryData.push(metrics);
      },
      onIORegistry: () => {},
      onError: () => {},
      onPinState: () => {},
      timeoutSec: 2,
    });

    // Wait for telemetry heartbeats
    await vi.advanceTimersByTimeAsync(2500);

    // Check that at least one telemetry report shows dropped bytes
    const hasDrops = telemetryData.some(
      (m) => m.serialDroppedBytesPerSecond > 0
    );

    expect(hasDrops).toBe(true);

    await runner.stop();
    await promise;
  });

  it("T-INT-04: setup() burst output uses burst budget (no drops for reasonable setup)", async () => {
    const setupSketch = `
      void setup() {
        Serial.begin(115200);
        // Large but reasonable setup output (~800 bytes)
        Serial.println("=== Arduino Simulator Starting ===");
        Serial.println("Version: 1.0.0");
        Serial.println("Baudrate: 115200");
        Serial.println("Memory: 2048 bytes");
        Serial.println("CPU: ATmega328P @ 16MHz");
        Serial.println("===================================");
        Serial.println("Initialization complete.");
        Serial.println("Ready.");
      }
      
      void loop() {
        delay(1000);
      }
    `;

    const promise = runner.runSketch({
      code: setupSketch,
      onOutput: (data) => {
        outputChunks.push(data);
      },
      onTelemetry: (metrics) => {
        telemetryData.push(metrics);
      },
      onIORegistry: () => {},
      onError: () => {},
      onPinState: () => {},
      timeoutSec: 2,
    });

    // Wait for setup to complete
    await vi.advanceTimersByTimeAsync(500);

    // Check that NO drop indicator appears in setup output
    const hasDropIndicator = outputChunks.some((chunk) =>
      chunk.includes("[⚠")
    );

    expect(hasDropIndicator).toBe(false);

    await runner.stop();
    await promise;
  });

  it("T-INT-05: pause() and resume() correctly manage batcher state", async () => {
    const sketch = `
      void setup() {
        Serial.begin(115200);
      }
      
      void loop() {
        Serial.println("tick");
        delay(50);
      }
    `;

    const promise = runner.runSketch({
      code: sketch,
      onOutput: (data) => {
        outputChunks.push(data);
      },
      onTelemetry: () => {},
      onIORegistry: () => {},
      onError: () => {},
      onPinState: () => {},
      timeoutSec: 10,
    });

    // Wait for some output
    await vi.advanceTimersByTimeAsync(300);
    const countBeforePause = outputChunks.length;

    // Pause
    runner.pause();
    await vi.advanceTimersByTimeAsync(500);
    const countDuringPause = outputChunks.length;

    // Should not increase during pause
    expect(countDuringPause).toBe(countBeforePause);

    // Resume
    runner.resume();
    await vi.advanceTimersByTimeAsync(300);
    const countAfterResume = outputChunks.length;

    // Should increase after resume
    expect(countAfterResume).toBeGreaterThan(countDuringPause);

    await runner.stop();
    await promise;
  });

  it("T-INT-06: stop() flushes remaining buffer without limit", async () => {
    const sketch = `
      void setup() {
        Serial.begin(9600);  // Low baudrate for testing
        // Generate lots of data
        for (int i = 0; i < 100; i++) {
          Serial.println("Data line that is somewhat long to accumulate bytes");
        }
      }
      
      void loop() {
        delay(10000);
      }
    `;

    const promise = runner.runSketch({
      code: sketch,
      onOutput: (data) => {
        outputChunks.push(data);
      },
      onTelemetry: () => {},
      onIORegistry: () => {},
      onError: () => {},
      onPinState: () => {},
      timeoutSec: 10,
    });

    // Wait a bit for setup to generate data
    await vi.advanceTimersByTimeAsync(200);

    // Stop simulation - should flush all pending data
    await runner.stop();
    await promise;

    // Check that we got substantial output (even with low baudrate)
    const totalOutput = outputChunks.join("");
    expect(totalOutput.length).toBeGreaterThan(1000);

    // stop() should NOT add drop indicators (unlimited flush)
    expect(totalOutput.includes("[⚠")).toBe(false);
  });
});

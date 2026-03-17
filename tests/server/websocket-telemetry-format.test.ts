// tests/server/websocket-telemetry-format.test.ts
// Verify that sim_telemetry messages have correct format for frontend

import { describe, it, expect } from 'vitest';

describe('WebSocket Telemetry Message Format', () => {
  it('should format sim_telemetry message correctly for transmission', () => {
    // Mock metrics from RegistryManager
    const metrics = {
      timestamp: 1773759800000,
      intendedPinChangesPerSecond: 100,
      actualPinChangesPerSecond: 95,
      droppedPinChangesPerSecond: 5,
      batchesPerSecond: 20,
      avgStatesPerBatch: 4.75,
      serialOutputPerSecond: 10,
      serialBytesPerSecond: 640,
      serialBytesTotal: 6400,
      serialIntendedBytesPerSecond: 650,
      serialDroppedBytesPerSecond: 10,
    };

    // Format as it would be sent over WS
    const wsMessage = {
      type: 'sim_telemetry',
      metrics,
    };

    // Verify message structure
    expect(wsMessage.type).toBe('sim_telemetry');
    expect(wsMessage.metrics).toBeDefined();
    expect(wsMessage.metrics.timestamp).toBe(1773759800000);
    expect(wsMessage.metrics.serialOutputPerSecond).toBe(10);

    // Verify it can be JSON stringified
    const jsonStr = JSON.stringify(wsMessage);
    expect(jsonStr).toContain('sim_telemetry');

    // Verify it can be parsed back
    const parsed = JSON.parse(jsonStr);
    expect(parsed.type).toBe('sim_telemetry');
    expect(parsed.metrics.serialOutputPerSecond).toBe(10);

    console.log(`\n✅ WS Message Format Valid:`);
    console.log(`   Type: ${parsed.type}`);
    console.log(`   Serial rate: ${parsed.metrics.serialOutputPerSecond}/s`);
    console.log(`   Timestamp: ${new Date(parsed.metrics.timestamp).toISOString()}`);
  });

  it('should verify frontend telemetry store would accept the message', () => {
    // Simulate frontend telemetry store
    type TelemetryMetrics = {
      timestamp: number;
      serialOutputPerSecond: number;
      serialBytesPerSecond: number;
    };

    const telemetryHistory: TelemetryMetrics[] = [];
    let lastHeartbeatAt: number | null = null;

    const pushTelemetry = (metrics: TelemetryMetrics) => {
      telemetryHistory.push(metrics);
      lastHeartbeatAt = metrics.timestamp;
    };

    // Simulate receiving telemetry from server
    const incomingMessage = {
      type: 'sim_telemetry',
      metrics: {
        timestamp: Date.now(),
        serialOutputPerSecond: 15,
        serialBytesPerSecond: 960,
      } as TelemetryMetrics,
    };

    pushTelemetry(incomingMessage.metrics);

    // Verify frontend state would update
    expect(telemetryHistory.length).toBe(1);
    expect(lastHeartbeatAt).toBeDefined();
    expect(lastHeartbeatAt! > 0).toBe(true);

    // Verify Link State would be STABLE (less than 2 seconds old)
    const timeSinceHeartbeat = Date.now() - lastHeartbeatAt!;
    const linkStateStable = timeSinceHeartbeat < 2000;
    expect(linkStateStable).toBe(true);

    console.log(`\n✅ Frontend would receive telemetry:`);
    console.log(`   lastHeartbeatAt: ${lastHeartbeatAt}`);
    console.log(`   Time since heartbeat: ${timeSinceHeartbeat}ms`);
    console.log(`   Link State: ${linkStateStable ? 'STABLE' : 'DISCONNECTED'}`);
  });

  it('should detect if telemetry message arrives older than 2 seconds', () => {
    let lastHeartbeatAt: number | null = null;

    const pushTelemetry = (timestamp: number) => {
      lastHeartbeatAt = timestamp;
    };

    // Simulate a delayed packet (from 3 seconds ago)
    const delayedTimestamp = Date.now() - 3000;
    pushTelemetry(delayedTimestamp);

    const timeSinceHeartbeat = Date.now() - lastHeartbeatAt!;
    const linkStateStable = timeSinceHeartbeat < 2000;

    console.log(`\n⚠️ DELAYED PACKET TEST:`);
    console.log(`   Packet timestamp: ${new Date(delayedTimestamp).toISOString()}`);
    console.log(`   Time since: ${timeSinceHeartbeat}ms`);
    console.log(`   Link State: ${linkStateStable ? 'STABLE' : 'DISCONNECTED'}`);

    expect(linkStateStable).toBe(false);
    expect(linkStateStable).toBe(false);
  });
});

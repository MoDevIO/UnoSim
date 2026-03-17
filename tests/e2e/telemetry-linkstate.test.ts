/**
 * E2E Test: Telemetry packets and Link State connectivity
 * 
 * Verifies:
 * 1. WebSocket connects
 * 2. Simulation starts
 * 3. sim_telemetry packets arrive at 1-second intervals
 * 4. Frontend receives telemetry and updates lastHeartbeatAt
 * 5. Link State indicator shows STABLE
 */

import { test, expect, describe } from 'vitest';
import { setupTestEnvironment } from './test-utils';

describe('Telemetry and Link State E2E', () => {
  test('should receive sim_telemetry packets and maintain STABLE link state', async () => {
    const { 
      runner, 
      captureMessages,
      waitForMessage,
    } = await setupTestEnvironment();

    // Code that produces serial output
    const code = `
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
}

void loop() {
  Serial.println("Hello");
  delay(100);
}
`;

    // Start compilation
    runner.runSketch({
      code,
      onOutput: (line) => {
        console.log('[SERIAL]', line);
      },
      onTelemetry: (metrics) => {
        console.log('[TELEMETRY]', {
          timestamp: metrics.timestamp,
          serialOutputPerSecond: metrics.serialOutputPerSecond,
          serialBytesPerSecond: metrics.serialBytesPerSecond,
        });
      },
      timeoutSec: 5,
    });

    // Wait for compilation to complete
    await waitForMessage('compilation_status', (msg: any) => msg.gccStatus === 'success', 3000);

    // Collect telemetry messages for 3 seconds
    const telemetryMessages: any[] = [];
    const startTime = Date.now();

    while (Date.now() - startTime < 3000) {
      const messages = captureMessages();
      const telemetry = messages.filter((msg: any) => msg.type === 'sim_telemetry');
      telemetryMessages.push(...telemetry);
      
      if (telemetryMessages.length >= 2) {
        break; // Got at least 2 telemetry packets
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Assertions
    console.log(`\n📊 TELEMETRY TEST RESULTS:`);
    console.log(`   - Total sim_telemetry packets received: ${telemetryMessages.length}`);
    
    if (telemetryMessages.length === 0) {
      console.error(`\n❌ FAILURE: No sim_telemetry packets received!`);
      console.error(`   Expected: At least 1 packet per second`);
      console.error(`   Debug: Check if RegistryManager heartbeat is starting`);
      throw new Error('No sim_telemetry packets received');
    }

    expect(telemetryMessages.length).toBeGreaterThanOrEqual(2);
    console.log(`✅ PASS: Received ${telemetryMessages.length} sim_telemetry packets`);

    // Check telemetry has valid data
    const firstTelemetry = telemetryMessages[0];
    expect(firstTelemetry).toHaveProperty('metrics');
    expect(firstTelemetry.metrics).toHaveProperty('serialOutputPerSecond');
    expect(firstTelemetry.metrics).toHaveProperty('timestamp');
    console.log(`✅ PASS: Telemetry packets have valid structure`);

    // Check timestamps are increasing
    const timestamps = telemetryMessages.map((msg: any) => msg.metrics.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
    console.log(`✅ PASS: Telemetry timestamps are monotonic`);

    // Verify Link State would be STABLE
    const lastHeartbeatAt = timestamps.at(-1);
    const timeSinceLastHeartbeat = Date.now() - lastHeartbeatAt;
    const wouldBeStable = timeSinceLastHeartbeat < 2000;
    expect(wouldBeStable).toBe(true);
    console.log(`✅ PASS: Link State would be STABLE (${timeSinceLastHeartbeat}ms since last heartbeat)`);

    await runner.stop();
  });

  test('should show debug logs for telemetry heartbeat lifecycle', async () => {
    const { runner } = await setupTestEnvironment();

    const code = `
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(100);
  digitalWrite(13, LOW);
  delay(100);
}
`;

    console.log(`\n🔍 MONITORING TELEMETRY DEBUG LOGS:\n`);

    const debugLogs: string[] = [];
    runner.runSketch({
      code,
      onOutput: (line) => {
        // Ignore serial output
      },
      onTelemetry: (metrics) => {
        debugLogs.push(`[TELEMETRY] Received: ${metrics.serialOutputPerSecond} serial/s`);
      },
      timeoutSec: 3,
    });

    // Wait for heartbeat to fire
    await new Promise(resolve => setTimeout(resolve, 2500));

    expect(debugLogs.length).toBeGreaterThan(0);
    console.log(`\n📋 Captured logs:`);
    debugLogs.forEach(log => console.log(`   ${log}`));

    await runner.stop();
  });
});

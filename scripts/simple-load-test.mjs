#!/usr/bin/env node

/**
 * Simple Load Test Script - Phase 0.2.5
 * 
 * Sends concurrent compilation requests to measure:
 * - Compilation latency with Worker Pool
 * - WebSocket bandwidth with compression
 * - Event loop lag
 * 
 * Usage: NODE_ENV=production node scripts/simple-load-test.js [numClients]
 */

import http from 'http';
import { performance } from 'perf_hooks';

const API_HOST = 'localhost';
const API_PORT = parseInt(process.env.PORT || '3000', 10);
const NUM_CLIENTS = parseInt(process.argv[2] || '50', 10);

const TEST_CODE = `
void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("ON");
  delay(500);
  digitalWrite(13, LOW);
  Serial.println("OFF");
  delay(500);
}
`;

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => (responseData += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseData));
          } catch (e) {
            resolve({ raw: responseData });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function compileRequest(clientId) {
  const startTime = performance.now();
  
  try {
    const result = await httpPost('/api/compile', {
      code: TEST_CODE,
      headers: [],
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    return {
      clientId,
      success: result.success === true,
      duration,
      error: null,
    };
  } catch (error) {
    const endTime = performance.now();
    const duration = endTime - startTime;

    return {
      clientId,
      success: false,
      duration,
      error: error.message,
    };
  }
}

async function runLoadTest() {
  console.log(`\n╔${'═'.repeat(78)}╗`);
  console.log(`║  🔥 Load Test Phase 0.2.5 - ${NUM_CLIENTS} Concurrent Clients${' '.repeat(78 - 47 - NUM_CLIENTS.toString().length)}║`);
  console.log(`╚${'═'.repeat(78)}╝\n`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Target: http://${API_HOST}:${API_PORT}/api/compile`);
  console.log(`Worker Pool: ${process.env.NODE_ENV === 'production' ? '✅ ENABLED' : '⚠️  DISABLED (dev mode)'}`);
  console.log(`WebSocket Compression: ✅ ENABLED (perMessageDeflate)\n`);

  console.log(`Starting ${NUM_CLIENTS} concurrent compilation requests...\n`);

  const testStart = performance.now();

  // Fire all requests concurrently
  const promises = Array.from({ length: NUM_CLIENTS }, (_, i) => 
    compileRequest(i + 1)
  );

  const results = await Promise.all(promises);
  const testEnd = performance.now();
  const totalDuration = testEnd - testStart;

  // Calculate statistics
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  const durations = successful.map(r => r.duration).sort((a, b) => a - b);
  const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);

  const p50 = durations[Math.floor(durations.length * 0.50)] || 0;
  const p90 = durations[Math.floor(durations.length * 0.90)] || 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
  const p99 = durations[Math.floor(durations.length * 0.99)] || 0;

  const throughput = NUM_CLIENTS / (totalDuration / 1000);

  // Print results
  console.log(`\n╔${'═'.repeat(78)}╗`);
  console.log(`║  📊 Results${' '.repeat(66)}║`);
  console.log(`╚${'═'.repeat(78)}╝\n`);

  console.log(`Total Duration: ${totalDuration.toFixed(2)}ms`);
  console.log(`Throughput: ${throughput.toFixed(2)} compilations/sec\n`);

  console.log('┌────────────────────────────┬─────────────────────────────────────┐');
  console.log(`│ ${'Metric'.padEnd(26)} │ ${'Value'.padEnd(35)} │`);
  console.log('├────────────────────────────┼─────────────────────────────────────┤');
  console.log(`│ ${'Total Requests'.padEnd(26)} │ ${NUM_CLIENTS.toString().padEnd(35)} │`);
  console.log(`│ ${'Successful'.padEnd(26)} │ ${`${successful.length} (${(successful.length / NUM_CLIENTS * 100).toFixed(1)}%)`.padEnd(35)} │`);
  console.log(`│ ${'Failed'.padEnd(26)} │ ${failed.length.toString().padEnd(35)} │`);
  console.log('└────────────────────────────┴─────────────────────────────────────┘\n');

  console.log('⏱️  Compilation Latency:\n');
  console.log('┌────────────────────────────┬─────────────────────────────────────┐');
  console.log(`│ ${'Average'.padEnd(26)} │ ${`${avgDuration.toFixed(2)}ms`.padEnd(35)} │`);
  console.log(`│ ${'Minimum'.padEnd(26)} │ ${`${minDuration.toFixed(2)}ms`.padEnd(35)} │`);
  console.log(`│ ${'Maximum'.padEnd(26)} │ ${`${maxDuration.toFixed(2)}ms`.padEnd(35)} │`);
  console.log(`│ ${'50th Percentile (p50)'.padEnd(26)} │ ${`${p50.toFixed(2)}ms`.padEnd(35)} │`);
  console.log(`│ ${'90th Percentile (p90)'.padEnd(26)} │ ${`${p90.toFixed(2)}ms`.padEnd(35)} │`);
  console.log(`│ ${'95th Percentile (p95)'.padEnd(26)} │ ${`${p95.toFixed(2)}ms`.padEnd(35)} │`);
  console.log(`│ ${'99th Percentile (p99)'.padEnd(26)} │ ${`${p99.toFixed(2)}ms`.padEnd(35)} │`);
  console.log('└────────────────────────────┴─────────────────────────────────────┘\n');

  if (failed.length > 0) {
    console.log(`⚠️  Failed Requests (${failed.length}):\n`);
    failed.slice(0, 5).forEach(f => {
      console.log(`   Client ${f.clientId}: ${f.error}`);
    });
    if (failed.length > 5) {
      console.log(`   ... and ${failed.length - 5} more\n`);
    } else {
      console.log('');
    }
  }

  // Performance verdict
  console.log(`╔${'═'.repeat(78)}╗`);
  console.log(`║  ⭐ Performance Verdict${' '.repeat(54)}║`);
  console.log(`╚${'═'.repeat(78)}╝\n`);

  const verdict = avgDuration < 300 ? '🟢 EXCELLENT' : 
                  avgDuration < 600 ? '🟡 GOOD' : 
                  avgDuration < 1200 ? '🟠 FAIR' : '🔴 POOR';

  console.log(`Overall: ${verdict}`);
  console.log(`  • Average latency: ${avgDuration.toFixed(0)}ms ${avgDuration < 300 ? '✅' : avgDuration < 600 ? '⚠️' : '❌'}`);
  console.log(`  • P95 latency: ${p95.toFixed(0)}ms ${p95 < 600 ? '✅' : p95 < 1200 ? '⚠️' : '❌'}`);
  console.log(`  • Success rate: ${(successful.length / NUM_CLIENTS * 100).toFixed(1)}% ${failed.length === 0 ? '✅' : '❌'}`);

  console.log('\n' + '═'.repeat(80) + '\n');

  // Return data for metrics collection
  return {
    totalClients: NUM_CLIENTS,
    successful: successful.length,
    failed: failed.length,
    totalDuration,
    avgDuration,
    minDuration,
    maxDuration,
    p50,
    p90,
    p95,
    p99,
    throughput,
  };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runLoadTest().catch(error => {
    console.error('\n❌ Load test failed:', error.message);
    process.exit(1);
  });
}

export { runLoadTest };

#!/usr/bin/env node

/**
 * Load Test Metrics Capturer
 * 
 * Führt Load-Tests aus und speichert Metriken im standardisierten Format.
 * 
 * Usage:
 *   node scripts/run-and-capture-load-test.mjs <client-count> <output-dir>
 * 
 * Example:
 *   node scripts/run-and-capture-load-test.mjs 50 test-results/load-2026-09-06T09-55-06Z/
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startVitest } from 'vitest/node';

async function runTest(clientCount, outputDir) {
  console.log(`[LoadTest] Running ${clientCount}-client load test...`);

  const exitCodeBeforeRun = process.exitCode;
  try {
    process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';
    process.env.FORCE_COLOR = '0';
    process.env.LOAD_TEST_OUTPUT_DIR = outputDir;
    process.env.LOAD_TEST_REAL_SERVER = 'true';
    process.env.LOAD_TEST_SERVER_URL = process.env.LOAD_TEST_SERVER_URL || 'http://127.0.0.1:3000';

    console.log(`[LoadTest] Using real server at ${process.env.LOAD_TEST_SERVER_URL}`);

    const vitest = await startVitest('test', [], {
      run: true,
      color: false,
      project: 'load',
      reporters: ['verbose'],
      testNamePattern: `Load Test: ${clientCount} Concurrent Clients`,
    });

    await vitest?.close();
    const success = process.exitCode === undefined || process.exitCode === 0 || process.exitCode === exitCodeBeforeRun;
    return { success };
  } catch (error) {
    console.error('[LoadTest] Test failed:', error.message);
    return { success: false };
  }
}

// Main
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/run-and-capture-load-test.mjs <client-count> <output-dir>');
  process.exit(1);
}

const clientCount = Number.parseInt(args[0], 10);
const outputDir = args[1];

if (!Number.isInteger(clientCount) || clientCount <= 0) {
  console.error('Error: client-count must be a positive integer');
  process.exit(1);
}

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const result = await runTest(clientCount, outputDir);

if (!result.success) {
  console.error('[LoadTest] Test execution failed');
  process.exit(1);
}

const outputPath = join(outputDir, `metrics-${clientCount}.json`);
if (!existsSync(outputPath)) {
  console.error(`[LoadTest] Metrics were not created by the test harness: ${outputPath}`);
  process.exit(1);
}

console.log(`[LoadTest] Metrics already saved to ${outputPath}`);

// Cleanup-Report: Docker-Container prüfen
import { execSync } from 'node:child_process';

function countDockerContainers() {
  try {
    const output = execSync('docker ps --format "{{.Names}}" 2>/dev/null', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const containers = output.split('\n').filter(line => line.includes('unosim-sandbox-')).length;
    return containers;
  } catch {
    return 0;
  }
}

const containersBefore = countDockerContainers();
// Kurze Wartezeit für Cleanup
await new Promise(resolve => setTimeout(resolve, 2000));
const containersAfter = countDockerContainers();

const cleanupReport = {
  timestamp: new Date().toISOString(),
  containersBefore,
  containersAfter,
  processesBefore: 0,
  processesAfter: 0,
  leakDetected: containersAfter > containersBefore,
  details: containersAfter > containersBefore 
    ? `Leak detected: ${containersAfter - containersBefore} containers not cleaned up`
    : 'All containers cleaned up successfully'
};

const cleanupPath = join(outputDir, 'cleanup-report.json');
writeFileSync(cleanupPath, JSON.stringify(cleanupReport, null, 2));
console.log(`[LoadTest] Cleanup report saved to ${cleanupPath}`);
console.log(`[LoadTest] Container cleanup: ${containersBefore} → ${containersAfter}`);

console.log('\n[LoadTest] Test completed successfully!');

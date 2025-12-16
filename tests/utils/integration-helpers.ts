/**
 * Integration Test Utilities
 * 
 * Helper functions for integration tests that require a running server.
 */

import http from 'http';
import { execSync } from 'child_process';

/**
 * Synchronously check if the server is running.
 * Uses curl or a quick TCP check to avoid async issues with Jest's describe().
 * Returns true if server responds, false otherwise.
 */
export function isServerRunningSync(): boolean {
  try {
    // Use curl with a very short timeout to check server availability
    execSync('curl -s --max-time 1 http://localhost:3000/api/sketches > /dev/null 2>&1', {
      timeout: 2000,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Async check if the server is running by making a simple HTTP request.
 * Returns true if server responds, false otherwise.
 */
export async function isServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/sketches',
        method: 'GET',
        timeout: 1000,
      },
      (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

/**
 * Cached sync server status (evaluated once at module load).
 * This is safe to use at the module level for describe.skip logic.
 */
export const SERVER_AVAILABLE = isServerRunningSync();

/**
 * Helper to create conditional describe - skips if server not available.
 */
export const describeIfServer = SERVER_AVAILABLE ? describe : describe.skip;

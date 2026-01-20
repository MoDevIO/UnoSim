import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import { describeIfServer } from '../utils/integration-helpers';

/**
 * Cache Optimization Test
 * 
 * Demonstrates compilation result caching:
 * - First compilation: Full compile time (~9 seconds)
 * - Subsequent compilations with same code: Cache hit (~50ms)
 * 
 * Diese Tests werden automatisch übersprungen wenn der Server nicht läuft.
 */

function fetchHttp(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options?.method || 'GET',
      headers: options?.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          json: async () => JSON.parse(data),
          text: async () => data,
        });
      });
    });

    req.on('error', reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

describeIfServer('Compilation Cache Optimization', () => {
  const API_BASE = 'http://localhost:3000';
  const TEST_CODE = `
void setup() {
  Serial.begin(115200);
  Serial.println("Hello World");
}

void loop() {
  delay(100);
  Serial.println("Running");
}
`;

  beforeAll(async () => {
    try {
      const response = await fetchHttp(`${API_BASE}/api/sketches`);
      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Server is not running. Start it with: npm run dev`);
    }
  });

  it('should demonstrate cache hit vs miss', async () => {
    const times = {
      firstCompile: 0,
      subsequentCompiles: [] as number[],
    };

    // Use unique code for this test to avoid cache hits from previous tests
    const uniqueCode = `
void setup() {
  Serial.begin(115200);
  Serial.println("Test at ${Date.now()}");
}

void loop() {
  delay(100);
  Serial.println("Running");
}
`;

    console.log('\n📊 CACHE OPTIMIZATION TEST RESULTS\n');
    console.log('🔴 FIRST COMPILATION (no cache):');
    
    const start1 = Date.now();
    const response1 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: uniqueCode }),
    });
    const firstCompileTime = Date.now() - start1;
    times.firstCompile = firstCompileTime;
    
    expect(response1.ok).toBe(true);
    const result1 = await response1.json();
    expect(result1.success).toBe(true);
    console.log(`   Time: ${firstCompileTime}ms`);
    console.log(`   Cached: ${result1.cached ? 'YES ⚠️' : 'NO ✓'}`);

    // ✅ SUBSEQUENT COMPILATIONS: With cache (same code)
    console.log('\n✅ SUBSEQUENT COMPILATIONS (cache hit):');
    
    for (let i = 0; i < 5; i++) {
      const startN = Date.now();
      const responseN = await fetchHttp(`${API_BASE}/api/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: uniqueCode }),
      });
      const compileTime = Date.now() - startN;
      times.subsequentCompiles.push(compileTime);
      
      expect(responseN.ok).toBe(true);
      const resultN = await responseN.json();
      expect(resultN.success).toBe(true);
      console.log(`   Request ${i + 1}: ${compileTime}ms (Cached: ${resultN.cached ? 'YES ✓' : 'NO'})`);
    }

    // 🔄 DIFFERENT CODE: No cache hit
    console.log('\n🔄 DIFFERENT CODE (cache miss):');
    const differentCode = uniqueCode + '\n// Different code ' + Date.now();
    
    const startDiff = Date.now();
    const responseDiff = await fetchHttp(`${API_BASE}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: differentCode }),
    });
    const diffCompileTime = Date.now() - startDiff;
    
    expect(responseDiff.ok).toBe(true);
    const resultDiff = await responseDiff.json();
    expect(resultDiff.success).toBe(true);
    console.log(`   Time: ${diffCompileTime}ms (Cached: ${resultDiff.cached ? 'YES' : 'NO ✓'})`);

    // 📈 PERFORMANCE COMPARISON
    const avgSubsequent = times.subsequentCompiles.reduce((a, b) => a + b, 0) / times.subsequentCompiles.length;
    const speedup = times.firstCompile / avgSubsequent;
    const savings = ((times.firstCompile - avgSubsequent) / times.firstCompile * 100).toFixed(1);

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║          🚀 CACHE OPTIMIZATION RESULTS                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n📊 Performance Metrics:`);
    console.log(`   First Compile (no cache):     ${times.firstCompile}ms`);
    console.log(`   Avg Subsequent (cache):       ${Math.round(avgSubsequent)}ms`);
    console.log(`   Time Saved per Request:       ${(times.firstCompile - avgSubsequent).toFixed(0)}ms`);
    console.log(`   Speedup Factor:               ${speedup.toFixed(1)}x faster`);
    console.log(`   Time Savings:                 ${savings}%`);

    console.log(`\n📈 Cache Efficiency:`);
    console.log(`   Total Requests:               ${1 + times.subsequentCompiles.length + 1}`);
    console.log(`   Cache Hits:                   ${times.subsequentCompiles.length}`);
    console.log(`   Cache Hit Rate:               ${(times.subsequentCompiles.length / (1 + times.subsequentCompiles.length + 1) * 100).toFixed(1)}%`);
    console.log(`   Total Time Saved:             ${((times.firstCompile - avgSubsequent) * times.subsequentCompiles.length).toFixed(0)}ms`);

    console.log(`\n🎯 Impact on 50-Client Load Test:`);
    const cachedLoadTestTime = (firstCompileTime + avgSubsequent * 49) / 1000;
    const originalLoadTestTime = 9.16; // From previous test
    const loadTestSavings = ((originalLoadTestTime - cachedLoadTestTime) / originalLoadTestTime * 100).toFixed(1);
    console.log(`   Original (no cache):          ${originalLoadTestTime}s (avg response time)`);
    console.log(`   With Cache:                   ${cachedLoadTestTime.toFixed(2)}s (avg response time)`);
    console.log(`   Time Saved:                   ${(originalLoadTestTime - cachedLoadTestTime).toFixed(2)}s per client`);
    console.log(`   Load Test Speedup:            ${(originalLoadTestTime / cachedLoadTestTime).toFixed(2)}x faster`);
    console.log(`   Improvement:                  ${loadTestSavings}%`);

    console.log('\n💡 Cache Strategy:');
    console.log(`   • Code is hashed (SHA-256) for unique identification`);
    console.log(`   • Cache valid for 5 minutes (TTL: 300s)`);
    console.log(`   • Only successful compilations are cached`);
    console.log(`   • Cache evicts on expire or code change`);
    console.log('\n');

    // Assertions - subsequent requests should be much faster (relaxed for slow hardware)
    const fastEnough = times.subsequentCompiles.filter(t => t < 500).length;
    expect(fastEnough).toBeGreaterThan(times.subsequentCompiles.length * 0.5); // 50% under 500ms
    expect(speedup).toBeGreaterThan(5); // Should be at least 5x faster
  }, 180000); // 3 minute timeout for slow systems

  it('should cache properly with identical headers', async () => {
    const code = `
void setup() {
  Serial.begin(115200);
}

void loop() {
  delay(100);
}
`;

    const headers = [
      { name: 'helper.h', content: 'int add(int a, int b) { return a + b; }' }
    ];

    // First compile with headers
    const response1 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, headers }),
    });
    expect(response1.ok).toBe(true);
    const result1 = await response1.json();
    expect(result1.success).toBe(true);
    // First request may or may not be cached depending on if it was just compiled

    // Second compile with same code and headers - should hit cache
    const response2 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, headers }),
    });
    expect(response2.ok).toBe(true);
    const result2 = await response2.json();
    expect(result2.success).toBe(true);
    expect(result2.cached).toBe(true); // Should definitely be cached on second request
  }, 60000);
});

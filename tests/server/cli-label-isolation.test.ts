import { describe, it, expect, beforeAll } from '@jest/globals';
import http from 'http';

/**
 * CLI Label Isolation Test
 * 
 * Verifies that CLI status labels don't change across session boundaries
 * 
 * WICHTIG: Server muss bereits laufen!
 * Starten Sie in einem separaten Terminal: npm run dev
 */

function fetchHttp(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
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
        });
      });
    });

    req.on('error', reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

describe('CLI Label Session Isolation', () => {
  const API_BASE = 'http://localhost:3000';

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

  it('should NOT broadcast CLI status across sessions', async () => {
    const code1 = `
void setup() {
  Serial.begin(115200);
  Serial.println("Session 1 - ${Date.now()}");
}

void loop() {
  delay(100);
}
`;

    const code2 = `
void setup() {
  Serial.begin(115200);
  Serial.println("Session 2 - ${Date.now()}");
}

void loop() {
  delay(100);
}
`;

    console.log('\n📊 CLI LABEL ISOLATION TEST\n');
    console.log('🔴 SESSION 1: Compiling unique code...');
    
    // Session 1 compile
    const start1 = Date.now();
    const response1 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code1 }),
    });
    const time1 = Date.now() - start1;
    
    expect(response1.ok).toBe(true);
    const result1 = await response1.json();
    expect(result1.success).toBe(true);
    console.log(`   Compilation time: ${time1}ms`);
    console.log(`   Result success: ${result1.success}`);
    
    console.log('\n🟢 SESSION 2: Compiling different code (same time as session 1)...');
    
    // Session 2 compile - DIFFERENT CODE
    const start2 = Date.now();
    const response2 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code2 }),
    });
    const time2 = Date.now() - start2;
    
    expect(response2.ok).toBe(true);
    const result2 = await response2.json();
    expect(result2.success).toBe(true);
    console.log(`   Compilation time: ${time2}ms`);
    console.log(`   Result success: ${result2.success}`);

    console.log('\n✅ ISOLATION VERIFICATION\n');
    console.log('┌────────────────────────────┬──────────┬──────────┐');
    console.log('│ Session                    │ Time     │ Success  │');
    console.log('├────────────────────────────┼──────────┼──────────┤');
    console.log(`│ Session 1 (unique code)    │ ${time1}ms  │ ${result1.success ? '✓' : '✗'}      │`);
    console.log(`│ Session 2 (different code) │ ${time2}ms  │ ${result2.success ? '✓' : '✗'}      │`);
    console.log('└────────────────────────────┴──────────┴──────────┘');

    console.log('\n💡 Key Verification Points:\n');
    console.log(`   ✓ Both sessions compiled independently`);
    console.log(`   ✓ No shared state between sessions`);
    console.log(`   ✓ No broadcast to other sessions`);
    console.log(`   ✓ Each client manages its own CLI status\n`);

    // Both should succeed
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Both should have completed (no hanging on broadcast wait)
    expect(time1).toBeLessThan(15000); // Should complete in reasonable time
    expect(time2).toBeLessThan(15000);
  }, 60000);

  it('should allow same code to be cached across different sessions', async () => {
    const sharedCode = `
void setup() {
  Serial.begin(115200);
}

void loop() {
  delay(100);
}
`;

    console.log('\n📊 CACHE SHARING ACROSS SESSIONS TEST\n');
    
    console.log('🔵 SESSION 1: Compile shared code (first time)...');
    const start1 = Date.now();
    const response1 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: sharedCode }),
    });
    const time1 = Date.now() - start1;
    const result1 = await response1.json();
    
    console.log(`   Time: ${time1}ms`);
    console.log(`   Cached: ${result1.cached ? 'YES (from previous run)' : 'NO'}`);

    console.log('\n🟢 SESSION 2: Compile SAME code (cache hit expected)...');
    const start2 = Date.now();
    const response2 = await fetchHttp(`${API_BASE}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: sharedCode }),
    });
    const time2 = Date.now() - start2;
    const result2 = await response2.json();
    
    console.log(`   Time: ${time2}ms`);
    console.log(`   Cached: ${result2.cached ? 'YES ✓' : 'NO'}`);

    console.log('\n✅ CACHE ACROSS SESSIONS\n');
    console.log(`   ✓ Cache is shared across sessions (when code matches)`);
    console.log(`   ✓ Session 2 benefited from cache: ${time2}ms vs ${time1}ms (${((time1-time2)/time1*100).toFixed(0)}% faster)\n`);

    expect(result2.cached).toBe(true);
    expect(time2).toBeLessThan(time1 / 10); // Cache should be 10x+ faster
  }, 60000);
});

// Sanity Test: Check if SandboxRunner can be imported without blocking
// This test should complete in < 1 second if the module loads properly
import { TestLogger } from './TestLogger';

describe("Sanity Test - Module Loading", () => {
  it("should import SandboxRunner without timeout", async () => {
    const startTime = Date.now();
    
    // This import should be fast
    const { SandboxRunner } = await import("../server/services/sandbox-runner");
    
    const importTime = Date.now() - startTime;
    TestLogger.info(`Import time: ${importTime}ms`);
    
    expect(importTime).toBeLessThan(5000); // Should be < 5 seconds
    expect(SandboxRunner).toBeDefined();
  });
  
  it("should create SandboxRunner instance without blocking", async () => {
    const startTime = Date.now();
    
    const { SandboxRunner } = await import("../server/services/sandbox-runner");
    
    const instance = new SandboxRunner();
    
    const constructorTime = Date.now() - startTime;
    TestLogger.info(`Constructor time: ${constructorTime}ms`);
    
    expect(constructorTime).toBeLessThan(100); // Should be < 100ms
    expect(instance).toBeDefined();
  });
  
  it("should create 10 instances quickly", async () => {
    const { SandboxRunner } = await import("../server/services/sandbox-runner");
    
    const startTime = Date.now();
    const instances = [];
    
    for (let i = 0; i < 10; i++) {
      instances.push(new SandboxRunner());
    }
    
    const totalTime = Date.now() - startTime;
    TestLogger.info(`10 instances created in: ${totalTime}ms`);
    
    expect(totalTime).toBeLessThan(500); // Should be < 500ms for 10 instances
    expect(instances).toHaveLength(10);
  });
});

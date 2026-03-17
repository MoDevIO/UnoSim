import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegistryManager } from '../../server/services/registry-manager';
import { PinStateBatcher } from '../../server/services/pin-state-batcher';
import { Logger } from '@shared/logger';

describe('RegistryManager destroyed flag reset after simulation', () => {
  let manager: RegistryManager;
  let telemetryCallback: ReturnType<typeof vi.fn>;
  let updateCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    telemetryCallback = vi.fn();
    updateCallback = vi.fn();
    
    manager = new RegistryManager({
      onTelemetry: telemetryCallback,
      onUpdate: updateCallback,
      enableTelemetry: true,
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.clearAllMocks();
  });

  it('should have destroyed=false initially', () => {
    // Manager should be ready for heartbeat
    const batcher = new PinStateBatcher('test');
    
    // Should start heartbeat without being destroyed
    manager.setPinStateBatcher(batcher);
    
    expect(telemetryCallback).not.toHaveBeenCalled(); // Not called yet (no tick)
    
    batcher.destroy();
  });

  it('should reset destroyed flag when reset() is called', () => {
    const batcher = new PinStateBatcher('test');
    manager.setPinStateBatcher(batcher);
    
    // Now destroy the manager
    manager.destroy();
    
    // The manager should have destroyed=true now
    // But when we call reset(), it should reset destroyed=false
    manager.reset();
    
    // Now we should be able to start a new heartbeat
    const batcher2 = new PinStateBatcher('test2');
    manager.setPinStateBatcher(batcher2);
    
    // Give the heartbeat a chance to fire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // After ~1 second, the heartbeat should have fired at least once
        expect(telemetryCallback.mock.calls.length).toBeGreaterThan(0);
        batcher2.destroy();
        resolve();
      }, 1100);
    });
  });

  it('should fire heartbeat on consecutive simulations', () => {
    const batcher1 = new PinStateBatcher('test1');
    manager.setPinStateBatcher(batcher1);
    
    let firstSimulationCallCount = 0;
    
    return new Promise<void>((resolve) => {
      // Wait for first heartbeat to fire
      const timer1 = setTimeout(() => {
        firstSimulationCallCount = telemetryCallback.mock.calls.length;
        expect(firstSimulationCallCount).toBeGreaterThan(0);
        
        // Simulate end of first simulation
        batcher1.destroy();
        manager.destroy();
        
        // Reset for next simulation
        manager.reset();
        telemetryCallback.mockClear();
        
        // Start second simulation
        const batcher2 = new PinStateBatcher('test2');
        manager.setPinStateBatcher(batcher2);
        
        // Wait for second heartbeat to fire
        const timer2 = setTimeout(() => {
          expect(telemetryCallback.mock.calls.length).toBeGreaterThan(0);
          batcher2.destroy();
          clearTimeout(timer2);
          resolve();
        }, 1100);
      }, 1100);
    });
  });
});

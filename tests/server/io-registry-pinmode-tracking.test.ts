import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SandboxRunner } from '../../server/services/sandbox-runner';
import type { IOPinRecord } from '@shared/schema';

describe('I/O Registry - pinMode Multiple Calls Detection', () => {
  let runner: SandboxRunner;
  let registryData: IOPinRecord[] = [];
  
  beforeEach(() => {
    runner = new SandboxRunner();
    registryData = [];
  });
  
  afterEach(async () => {
    // Give a bit of time for cleanup before stopping
    await new Promise(resolve => setTimeout(resolve, 100));
    if (runner.isRunning) {
      runner.stop();
    }
  });

  const runAndCollectRegistry = async (code: string): Promise<IOPinRecord[]> => {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (runner.isRunning) runner.stop();
        reject(new Error('Registry collection timeout'));
      }, 20000); // 20s timeout to handle cold start compilation

      let latestRegistry: IOPinRecord[] | null = null;
      let registryReceived = false;
      let processExited = false;

      const finish = (fn: (value?: unknown) => void, value?: unknown) => {
        clearTimeout(timer);
        if (runner.isRunning) runner.stop();
        fn(value);
      };

      runner.runSketch(
        code,
        () => {}, // onOutput
        (errLine) => {
          // Ignore structured pin state markers that surface on stderr when no onPinState is provided
          if (/^\[\[PIN_MODE:\d+:\d+\]\]$/.test(errLine)) return;
          if (/^\[\[IO_PIN:/.test(errLine)) return; // Ignore registry lines too
          finish(reject, new Error(errLine));
        },
        () => {
          processExited = true;
          if (registryReceived && latestRegistry) {
            finish(resolve, latestRegistry);
          } else if (!registryReceived) {
            // Wait longer for registry callback if process exited early
            setTimeout(() => {
              if (latestRegistry) {
                finish(resolve, latestRegistry);
              } else {
                finish(reject, new Error('Registry data not received before process exit'));
              }
            }, 2000); // 2s wait for slow hardware
          }
        }, // onExit
        undefined, // onCompileError
        undefined, // onCompileSuccess
        () => {}, // onPinState (consume pin state markers so they don't hit onError)
        2, // 2 second timeout (allow enough time for compilation + execution)
        (registry) => {
          latestRegistry = registry;
          registryReceived = true;
          if (processExited) {
            finish(resolve, latestRegistry);
          }
        }
      );
    });
  };

  it('should track single pinMode call in operations', async () => {
    const code = `
      void setup() {
        pinMode(5, OUTPUT);
      }
      void loop() {}
    `;

    registryData = await runAndCollectRegistry(code);

    const pin5 = registryData.find(p => p.pin === '5');
    expect(pin5).toBeDefined();
    expect(pin5!.defined).toBe(true);
    
    const pinModeOps = pin5!.usedAt?.filter(u => u.operation.includes('pinMode')) || [];
    expect(pinModeOps.length).toBe(1);
    expect(pinModeOps[0].operation).toBe('pinMode:1'); // OUTPUT = 1
  }, 30000);

  it('should track multiple pinMode calls with different modes (conflict)', async () => {
    const code = `
      void setup() {
        pinMode(5, OUTPUT);
        pinMode(5, INPUT);
      }
      void loop() {}
    `;

    registryData = await runAndCollectRegistry(code);

    const pin5 = registryData.find(p => p.pin === '5');
    expect(pin5).toBeDefined();
    
    const pinModeOps = pin5!.usedAt?.filter(u => u.operation.includes('pinMode')) || [];
    expect(pinModeOps.length).toBe(2);
    expect(pinModeOps[0].operation).toBe('pinMode:1'); // OUTPUT
    expect(pinModeOps[1].operation).toBe('pinMode:0'); // INPUT
    
    const modes = pinModeOps.map(op => op.operation);
    const uniqueModes = [...new Set(modes)];
    expect(uniqueModes.length).toBe(2); // Conflict detected
  }, 30000);

  it('should track repeated pinMode calls with same mode', async () => {
    const code = `
      void setup() {
        pinMode(3, INPUT);
        pinMode(3, INPUT);
        pinMode(3, INPUT);
      }
      void loop() {}
    `;

    registryData = await runAndCollectRegistry(code);

    const pin3 = registryData.find(p => p.pin === '3');
    expect(pin3).toBeDefined();
    
    const pinModeOps = pin3!.usedAt?.filter(u => u.operation.includes('pinMode')) || [];
    expect(pinModeOps.length).toBe(3);
    expect(pinModeOps.every(op => op.operation === 'pinMode:0')).toBe(true); // All INPUT
  }, 30000);

  it('should track pinMode:2 for INPUT_PULLUP', async () => {
    const code = `
      void setup() {
        pinMode(7, INPUT_PULLUP);
      }
      void loop() {}
    `;

    registryData = await runAndCollectRegistry(code);

    const pin7 = registryData.find(p => p.pin === '7');
    expect(pin7).toBeDefined();
    
    const pinModeOps = pin7!.usedAt?.filter(u => u.operation.includes('pinMode')) || [];
    expect(pinModeOps.length).toBe(1);
    expect(pinModeOps[0].operation).toBe('pinMode:2'); // INPUT_PULLUP = 2
  }, 30000);

  it('should track complex scenario with conflicts and repeats', async () => {
    const code = `
      void setup() {
        pinMode(5, OUTPUT);
        pinMode(5, OUTPUT);
        pinMode(5, INPUT);
        pinMode(5, OUTPUT);
      }
      void loop() {}
    `;

    registryData = await runAndCollectRegistry(code);

    const pin5 = registryData.find(p => p.pin === '5');
    expect(pin5).toBeDefined();
    
    const pinModeOps = pin5!.usedAt?.filter(u => u.operation.includes('pinMode')) || [];
    expect(pinModeOps.length).toBe(4);
    
    const modes = pinModeOps.map(op => {
      const match = op.operation.match(/pinMode:(\d+)/);
      return match ? parseInt(match[1]) : -1;
    });
    
    expect(modes).toEqual([1, 1, 0, 1]); // OUTPUT, OUTPUT, INPUT, OUTPUT
    
    const uniqueModes = [...new Set(modes)];
    expect(uniqueModes.length).toBe(2); // Has conflict
    
    const outputCount = modes.filter(m => m === 1).length;
    const inputCount = modes.filter(m => m === 0).length;
    expect(outputCount).toBe(3);
    expect(inputCount).toBe(1);
  }, 30000);

  it('should not include pinMode in other operations', async () => {
    const code = `
      void setup() {
        pinMode(5, OUTPUT);
        digitalWrite(5, HIGH);
        digitalRead(5);
      }
      void loop() {}
    `;

    registryData = await runAndCollectRegistry(code);

    const pin5 = registryData.find(p => p.pin === '5');
    expect(pin5).toBeDefined();
    
    const allOps = pin5!.usedAt || [];
    expect(allOps.length).toBeGreaterThanOrEqual(3); // pinMode, digitalWrite, digitalRead
    
    const pinModeOps = allOps.filter(u => u.operation.includes('pinMode'));
    const writeOps = allOps.filter(u => u.operation.includes('digitalWrite'));
    const readOps = allOps.filter(u => u.operation.includes('digitalRead'));
    
    expect(pinModeOps.length).toBe(1);
    expect(writeOps.length).toBe(1);
    expect(readOps.length).toBe(1);
    
    expect(pinModeOps[0].operation).toBe('pinMode:1');
  }, 30000);
});

import { describe, it, expect, vi } from 'vitest';
import { SandboxRunner } from '../../../server/services/sandbox-runner';

// give the test a generous timeout because the runner needs to compile/start
vi.setConfig({ testTimeout: 30000 });

describe('Ghost Output Reproduction', () => {
  it('should keep ProcessController listener counts stable across runs', async () => {
    const runner = new SandboxRunner();

    const ctrl: any = (runner as any).processController;
    // initial state should have no listeners
    expect(ctrl.stdoutListeners.length).toBe(0);
    expect(ctrl.stderrListeners.length).toBe(0);

    // first run
    let registryCalls = 0;
    runner.runSketch({ code: 'void setup() {}', onOutput: () => {}, onIORegistry: () => { registryCalls++; } });
    // wait until a process exists AND listeners have been attached
    while (!(ctrl.hasProcess() && ctrl.stdoutListeners.length > 0)) {
      await new Promise(r => setTimeout(r, 10));
    }
    // simulate a registry packet arriving via stderr listener
    ctrl.stderrListeners.forEach((cb: any) => cb(Buffer.from('[[IO_REGISTRY_START]]\n')));
    expect(registryCalls).toBe(1);

    const firstStdoutCount = ctrl.stdoutListeners.length;
    const firstStderrCount = ctrl.stderrListeners.length;

    await runner.stop();

    // second run reusing the same runner
    registryCalls = 0;
    runner.runSketch({ code: 'void setup() {}', onOutput: () => {}, onIORegistry: () => { registryCalls++; } });
    while (!(ctrl.hasProcess() && ctrl.stdoutListeners.length > 0)) {
      await new Promise(r => setTimeout(r, 10));
    }
    // simulate again
    ctrl.stderrListeners.forEach((cb: any) => cb(Buffer.from('[[IO_REGISTRY_START]]\n')));
    expect(registryCalls).toBe(1);

    const secondStdoutCount = ctrl.stdoutListeners.length;
    const secondStderrCount = ctrl.stderrListeners.length;

    // listener counts should not increase
    expect(secondStdoutCount).toBe(firstStdoutCount);
    expect(secondStderrCount).toBe(firstStderrCount);
  });
});

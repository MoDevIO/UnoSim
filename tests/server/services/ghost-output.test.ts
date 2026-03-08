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
    expect(ctrl.stderrLineListeners.length).toBe(0);

    // first run
    runner.runSketch({ code: 'void setup() {}', onOutput: () => {}, onIORegistry: () => {} });
    // wait until a process exists AND listeners have been attached
    while (!(ctrl.hasProcess() && ctrl.stderrLineListeners.length > 0)) {
      await new Promise(r => setTimeout(r, 10));
    }

    const firstStdoutCount = ctrl.stdoutListeners.length;
    const firstStderrCount = ctrl.stderrListeners.length;
    const firstStderrLineCount = ctrl.stderrLineListeners.length;

    console.log('[TEST] After first run:', { firstStdoutCount, firstStderrCount, firstStderrLineCount });

    await runner.stop();

    // second run reusing the same runner
    runner.runSketch({ code: 'void setup() {}', onOutput: () => {}, onIORegistry: () => {} });
    while (!(ctrl.hasProcess() && ctrl.stderrLineListeners.length > 0)) {
      await new Promise(r => setTimeout(r, 10));
    }

    const secondStdoutCount = ctrl.stdoutListeners.length;
    const secondStderrCount = ctrl.stderrListeners.length;
    const secondStderrLineCount = ctrl.stderrLineListeners.length;

    console.log('[TEST] After second run:', { secondStdoutCount, secondStderrCount, secondStderrLineCount });

    // listener counts should not increase (no Ghost Output accumulation)
    expect(secondStdoutCount).toBe(firstStdoutCount);
    expect(secondStderrCount).toBe(firstStderrCount);
    expect(secondStderrLineCount).toBe(firstStderrLineCount);
  });
});

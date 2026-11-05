import type { SandboxRunner } from "../../server/services/sandbox-runner";

/**
 * A `writeStdin` for a mocked process controller that answers like the runtime: every `[[PAUSE_TIME:n]]` is
 * acknowledged with `[[TIME_FROZEN:n:…]]` at once, so a pause goes on to stop the process.
 */
export function acknowledgingWriteStdin(runner: SandboxRunner): (data: string) => boolean {
  return (data: string) => {
    const pause = /^\[\[PAUSE_TIME:(\d+)\]\]/.exec(data);
    if (pause) (runner as any).executionState.onTimeFrozen?.(Number(pause[1]));
    return true;
  };
}

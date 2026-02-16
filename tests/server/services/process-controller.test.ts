import { describe, it, expect } from "vitest";
import { ProcessController } from "../../../server/services/process-controller";

describe("ProcessController — unit", () => {
  it("forwards stdout data to registered listeners (pre/post-spawn)", async () => {
    const pc = new ProcessController();

    let a = "";
    let b = "";

    // Capture spawn errors (fail test if spawn fails)
    let spawnErr: Error | null = null;
    pc.onError((err) => { spawnErr = err; });

    // listener added BEFORE spawn
    pc.onStdout((d) => { a += d.toString(); });

    // Spawn a short-lived node process that writes after a small delay so
    // listeners (pre- and post-spawn) are already registered when data arrives.
    pc.spawn("node", ["-e", `setTimeout(()=>{ process.stdout.write('PC-HELLO\\n'); }, 40); setTimeout(()=>process.exit(0), 120);`]);

    // listener added AFTER spawn should still receive data
    pc.onStdout((d) => { b += d.toString(); });

    // wait for first stdout chunk (or fail after timeout)
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout waiting for stdout')), 1500);
      const onData = (d: Buffer) => {
        clearTimeout(to);
        // resolve once either listener has been invoked
        resolve();
      };
      pc.onStdout(onData);
    });

    if (spawnErr) throw spawnErr;

    // wait for close to be clean
    await new Promise<void>((res) => pc.onClose(() => res()));

    expect(a).toContain("PC-HELLO");
    expect(b).toContain("PC-HELLO");
  });

  it("kill semantics: process closes after kill() and close handler is invoked", async () => {
    const pc = new ProcessController();
    let stdoutCount = 0;
    let closed = false;
    let spawnErr: Error | null = null;

    pc.onError((err) => { spawnErr = err; });
    pc.onStdout((d) => { stdoutCount += (d.toString() || "").length > 0 ? 1 : 0; });
    pc.onClose(() => { closed = true; });

    // long-running process that emits every 25ms (give listener time to attach)
    pc.spawn("node", ["-e", `setInterval(()=>process.stdout.write('TICK\\n'), 25);`]);

    // wait for the first tick (or timeout)
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('no stdout tick observed')), 1500);
      const onTick = () => {
        clearTimeout(to);
        resolve();
      };
      pc.onStdout(() => onTick());
    });

    if (spawnErr) throw spawnErr;
    expect(stdoutCount).toBeGreaterThanOrEqual(1);

    // kill and wait for close
    pc.kill("SIGKILL");
    await new Promise<void>((res) => pc.onClose(() => res()));

    expect(closed).toBe(true);

    // After close, writeStdin must be safe and should return false
    expect(pc.writeStdin("x")).toBe(false);
  });

  it("robustness: writeStdin after process exit returns false and does not throw", async () => {
    const pc = new ProcessController();

    // process that exits shortly
    pc.spawn("node", ["-e", `process.stdin.resume(); setTimeout(()=>process.exit(0), 20);`]);

    await new Promise<void>((res) => pc.onClose(() => res()));

    let ok = true;
    try {
      const wrote = pc.writeStdin("after-exit\n");
      // writeStdin should be false because stdin/pipe no longer present
      expect(wrote).toBe(false);
    } catch (err) {
      ok = false;
    }

    expect(ok).toBe(true);
  });
});

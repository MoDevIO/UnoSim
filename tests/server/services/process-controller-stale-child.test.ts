import { describe, expect, it } from "vitest";
import { ProcessController } from "../../../server/services/process-controller";

describe("ProcessController with a replaced child", () => {
  it("does not forward output or close of a previous child to the next run's listeners", async () => {
    const controller = new ProcessController();
    await controller.spawn("node", ["-e", String.raw`setTimeout(() => { process.stdout.write('OLD-CHILD\n'); process.exit(0); }, 150);`]);

    // The next run replaces the child and its listeners before the old child speaks.
    controller.clearListeners();
    let output = "";
    const closes: Array<number | null> = [];
    controller.onStdout((data) => { output += data.toString(); });
    controller.onClose((code) => closes.push(code));
    await controller.spawn("node", ["-e", String.raw`setTimeout(() => { process.stdout.write('NEW-CHILD\n'); process.exit(3); }, 400);`]);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("new child did not close")), 3_000);
      controller.onClose(() => { clearTimeout(timer); resolve(); });
    });

    expect(output).toBe("NEW-CHILD\n");
    expect(closes).toEqual([3]);
  });
});
